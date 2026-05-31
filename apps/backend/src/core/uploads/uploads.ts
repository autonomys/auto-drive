import { v4 } from 'uuid'
import {
  UploadEntry,
  uploadsRepository,
} from '../../infrastructure/repositories/uploads/uploads.js'
import {
  FileUpload,
  FolderUpload,
  Upload,
  UploadStatus,
  UploadType,
  FolderTreeFolder,
  UserWithOrganization,
} from '@auto-drive/models'
import { filePartsRepository } from '../../infrastructure/repositories/uploads/fileParts.js'
import { UploadFileProcessingUseCase } from './uploadProcessing.js'
import { fileProcessingInfoRepository } from '../../infrastructure/repositories/uploads/fileProcessingInfo.js'
import { NodesUseCases } from '../objects/nodes.js'
import { ObjectUseCases } from '../objects/object.js'
import { cidToString, FileUploadOptions } from '@autonomys/auto-dag-data'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { createTask, Task } from '../../infrastructure/eventRouter/tasks.js'
import { config } from '../../config.js'
import { blockstoreRepository } from '../../infrastructure/repositories/uploads/blockstore.js'
import { BlockstoreUseCases } from './blockstore.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { BadRequestError, ObjectNotFoundError } from '../../errors/index.js'
import { err, ok, Result } from 'neverthrow'

const logger = createLogger('useCases:uploads:uploads')

export const mapTableToModel = (upload: UploadEntry): Upload => {
  return {
    id: upload.id,
    rootId: upload.root_upload_id,
    relativeId: upload.relative_id,
    type: upload.type,
    status: upload.status,
    fileTree: upload.file_tree,
    name: upload.name,
    mimeType: upload.mime_type,
    oauthProvider: upload.oauth_provider,
    oauthUserId: upload.oauth_user_id,
    uploadOptions: upload.upload_options,
  } as Upload
}

const checkPermissions = async (
  upload: UploadEntry,
  user: UserWithOrganization,
) => {
  if (
    upload.oauth_provider !== user.oauthProvider ||
    upload.oauth_user_id !== user.oauthUserId
  ) {
    throw new Error('User does not have permission to upload')
  }
}

const initFileProcessing = async (upload: UploadEntry): Promise<void> => {
  await fileProcessingInfoRepository.addFileProcessingInfo({
    upload_id: upload.id,
    last_processed_part_index: null,
    pending_bytes: null,
    created_at: new Date(),
    updated_at: new Date(),
  })
}

const createFileUpload = async (
  user: UserWithOrganization,
  name: string,
  mimeType: string | null,
  uploadOptions: FileUploadOptions | null,
  rootId?: string | null,
  relativeId?: string | null,
): Promise<FileUpload> => {
  logger.debug(
    'createFileUpload invoked (userId=%s, name=%s)',
    user.oauthUserId,
    name,
  )
  rootId = rootId ?? null
  relativeId = relativeId ?? null

  const id = v4()
  const upload = await uploadsRepository.createUploadEntry(
    id,
    UploadType.FILE,
    UploadStatus.PENDING,
    name,
    null,
    mimeType,
    rootId ?? id,
    relativeId,
    user.oauthProvider,
    user.oauthUserId,
    uploadOptions,
  )

  await initFileProcessing(upload)

  return mapTableToModel(upload) as FileUpload
}

export const createFolderUpload = async (
  user: UserWithOrganization,
  name: string,
  folderTree: FolderTreeFolder,
  uploadOptions: FileUploadOptions | null,
): Promise<FolderUpload> => {
  const uploadId = v4()
  const result = await uploadsRepository.createUploadEntry(
    uploadId,
    UploadType.FOLDER,
    UploadStatus.PENDING,
    name,
    folderTree,
    null,
    uploadId,
    null,
    user.oauthProvider,
    user.oauthUserId,
    uploadOptions,
  )

  return mapTableToModel(result) as FolderUpload
}

const createFileInFolder = async (
  user: UserWithOrganization,
  uploadId: string,
  relativeId: string,
  name: string,
  mimeType: string | null,
  uploadOptions: FileUploadOptions | null = null,
): Promise<FileUpload> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }

  if (upload.type !== UploadType.FOLDER) {
    throw new Error('Upload is not a folder')
  }

  const file = await createFileUpload(
    user,
    name,
    mimeType,
    uploadOptions,
    uploadId,
    relativeId,
  )

  return file
}

// Per-upload in-process serialisation for the drain.  Concurrent UploadPart
// requests for the same upload_id must not interleave their reads and updates
// of last_processed_part_index — without this lock, two drains can both read
// the same `next` index, both find the same chunk in file_parts, and both
// call processChunk → silent double-processing of the same bytes into the
// IPLD tree.
//
// This is in-process only; multi-process deployments would still race across
// processes.  A PostgreSQL advisory lock would be the cross-process fix, but
// requires routing every drain step through a single connection — out of
// scope for this PR.  In practice the express server is currently one
// instance per region, so in-process serialisation removes the realistic
// race.
const drainLocks = new Map<string, Promise<unknown>>()

const withDrainLock = async <T>(
  uploadId: string,
  fn: () => Promise<T>,
): Promise<T> => {
  // Chain after any in-flight drain.  Swallow the previous drain's error so
  // a failure on one caller does not poison subsequent waiters; each caller
  // still observes its own fn's outcome.
  const previous = drainLocks.get(uploadId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(fn)
  drainLocks.set(uploadId, current)
  try {
    return await current
  } finally {
    if (drainLocks.get(uploadId) === current) {
      drainLocks.delete(uploadId)
    }
  }
}

// Process the chunks persisted in uploads.file_parts that now form a
// contiguous run starting at last_processed_part_index + 1.
//
// THE CALLER MUST HOLD withDrainLock(uploadId).  This function reads and
// advances the shared last_processed_part_index cursor; running two copies
// concurrently for the same upload would double-process or skip chunks.
//
// For an in-order client the loop processes exactly the chunk just stored
// and exits immediately — the streaming-during-upload optimisation is
// preserved.  For an out-of-order client it is a no-op until the next
// expected chunk arrives, at which point it catches up by processing every
// already-stored chunk that now follows in sequence.
//
// S3 multipart explicitly allows parts to arrive in any order; the previous
// implementation rejected non-monotonic arrivals at the processing layer
// and silently produced a corrupted assembled object (see #725).
const drainLoop = async (uploadId: string): Promise<void> => {
  let hasMore = true
  while (hasMore) {
    const info =
      await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(
        uploadId,
      )
    if (!info) {
      throw new Error('File processing info not found')
    }
    const next =
      info.last_processed_part_index == null
        ? 0
        : info.last_processed_part_index + 1
    const part = await filePartsRepository.getChunkByUploadIdAndPartIndex(
      uploadId,
      next,
    )
    if (!part) {
      hasMore = false
    } else {
      await UploadFileProcessingUseCase.processChunk(uploadId, part.data, next)
    }
  }
}

// Refuse to finalise when the stored parts have gaps — i.e. file_parts rows
// exist with part_index beyond the last_processed_part_index after the drain.
// S3 requires the parts list in CompleteMultipartUpload to be contiguous
// starting at PartNumber 1; a gap means the client either lied about which
// parts they uploaded or a part is genuinely missing.  Without this check
// the size returned by getUploadFilePartsSize would include bytes that never
// entered the IPLD tree, and the assembled object's metadata would be
// internally inconsistent.
//
// THE CALLER MUST HOLD withDrainLock(uploadId) so the cursor it reads is
// stable against a concurrent drain.
const assertNoUnprocessedParts = async (uploadId: string): Promise<void> => {
  const info =
    await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(uploadId)
  const lastProcessed = info?.last_processed_part_index ?? -1
  // Index-only query — never loads the part data column (parts can be multi-GB).
  const unprocessed = await filePartsRepository.getPartIndicesGreaterThan(
    uploadId,
    lastProcessed,
  )
  if (unprocessed.length > 0) {
    throw new BadRequestError(
      `Cannot complete upload: parts stored but not processed (gap in sequence) at part_index=[${unprocessed.join(',')}]`,
    )
  }
}

const uploadChunk = async (
  user: UserWithOrganization,
  uploadId: string,
  index: number,
  chunkData: Buffer,
): Promise<void> => {
  logger.trace(
    'uploadChunk invoked (uploadId=%s, partIndex=%d, userId=%s)',
    uploadId,
    index,
    user.oauthUserId,
  )
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    logger.error('Upload not found (uploadId=%s)', uploadId)
    throw new Error('Upload not found')
  }
  await checkPermissions(upload, user)

  // The processed-cursor read, the divergent-content guard, the store, and the
  // drain must be atomic per upload.  Without serialisation, two concurrent
  // UploadPart requests for the same part_index could both read a
  // pre-processing cursor, both pass the guard, then race the store against
  // the drain — leaving file_parts and the IPLD tree disagreeing (Bugbot,
  // #726).  withDrainLock serialises all uploadChunk work for the same
  // upload_id within this process.
  //
  // Cost: parts of the *same* upload no longer store in parallel.  IPLD
  // processing is inherently serial per upload anyway (the tree is built in
  // part order), so the impact is bounded by the per-part INSERT latency
  // added to the already-serial critical section.  Distinct uploads
  // (different upload_id) remain fully parallel.  This serialisation is
  // in-process only — see the withDrainLock comment for the multi-process
  // caveat.
  await withDrainLock(uploadId, async () => {
    const info =
      await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(
        uploadId,
      )
    const lastProcessed = info?.last_processed_part_index ?? -1

    // A part already processed into the IPLD tree is immutable: the streaming
    // model cannot splice replacement bytes into a built tree.  S3 allows
    // re-uploading a PartNumber, but clients only do so to recover from
    // delivery uncertainty — the bytes are identical.  Accept an identical
    // re-upload as a harmless no-op; reject a *divergent* re-upload rather
    // than silently leaving the stored object inconsistent with the per-part
    // ETag the client computed (the assembled CID would reflect the original
    // bytes, the size and composite ETag the new bytes).
    if (index <= lastProcessed) {
      const existing = await filePartsRepository.getChunkByUploadIdAndPartIndex(
        uploadId,
        index,
      )
      if (existing && Buffer.compare(existing.data, chunkData) !== 0) {
        throw new BadRequestError(
          `Cannot replace already-processed part ${index} with different content`,
        )
      }
      // Identical retry of an already-processed part — nothing to store or
      // process; the per-part ETag is recomputed from the body by the caller.
      return
    }

    // Persist at the declared position.  The (upload_id, part_index) primary
    // key means each chunk lands at its position regardless of arrival order,
    // which is what S3 multipart requires.  Then process every chunk that now
    // forms a contiguous run from the next expected index.
    await filePartsRepository.addChunk({
      upload_id: uploadId,
      part_index: index,
      data: chunkData,
      created_at: new Date(),
      updated_at: new Date(),
    })
    await drainLoop(uploadId)
  })
}

const completeUpload = async (
  user: UserWithOrganization,
  uploadId: string,
): Promise<string> => {
  logger.debug(
    'completeUpload invoked (uploadId=%s, userId=%s)',
    uploadId,
    user.oauthUserId,
  )
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    logger.warn('Upload not found (uploadId=%s)', uploadId)
    throw new Error('Upload not found')
  }
  await checkPermissions(upload, user)

  // Safety net for FILE uploads: process any chunks that were stored but
  // not yet processed, then verify there is no gap.  For a healthy in-order
  // upload the drain is a no-op (uploadChunk drains synchronously after each
  // store).  For uploads where the final contiguous run is only complete at
  // the moment of CompleteMultipartUpload — typically because some part
  // arrived just before completion — this catches them up before finalising
  // the IPLD tree.  Folder uploads have no file_processing_info row and skip
  // this step entirely; their finalisation runs through processFolderUpload.
  //
  // Drain and gap-check run under one drain lock so a concurrent uploadChunk
  // cannot advance the cursor or insert a part between them.  drainLoop and
  // assertNoUnprocessedParts are lockless helpers; calling them inside the
  // lock here is correct (and calling the lock-acquiring path would
  // deadlock — withDrainLock is not reentrant).
  if (upload.type === UploadType.FILE) {
    await withDrainLock(uploadId, async () => {
      await drainLoop(uploadId)
      // After the drain, every stored part must have been processed.  Any
      // remaining gap means the parts list is incomplete — refuse to finalise
      // rather than emit a CID for an object whose stored byte total includes
      // bytes that are absent from the IPLD tree.
      await assertNoUnprocessedParts(uploadId)
    })
  }

  const cid = await UploadFileProcessingUseCase.completeUploadProcessing(upload)

  if (upload.type === UploadType.FILE) {
    await UploadFileProcessingUseCase.handleFileUploadFinalization(
      user,
      uploadId,
    )
  } else if (upload.type === UploadType.FOLDER) {
    await UploadFileProcessingUseCase.handleFolderUploadFinalization(
      user,
      uploadId,
    )
  }

  const updatedUpload = {
    ...upload,
    status: UploadStatus.MIGRATING,
  }

  await uploadsRepository.updateUploadEntry(updatedUpload)

  const isRootUpload = upload.root_upload_id === uploadId
  if (isRootUpload) {
    await scheduleNodeMigration(uploadId)
  }

  logger.debug(
    'Upload completed (uploadId=%s, cid=%s, isRootUpload=%s)',
    uploadId,
    cidToString(cid),
  )
  return cidToString(cid)
}

const getFileFromFolderUpload = async (
  uploadId: string,
): Promise<UploadEntry[]> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }
  if (upload.type !== UploadType.FOLDER) {
    throw new Error('Upload is not a folder')
  }

  const folderWithFiles = await uploadsRepository.getUploadsByRoot(uploadId)

  return folderWithFiles.filter((e) => e.type === UploadType.FILE)
}

const createSubFolderUpload = async (
  rootId: string,
  fileTree: FolderTreeFolder,
): Promise<FolderUpload> => {
  const parentUpload = await uploadsRepository.getUploadEntryById(rootId)
  if (!parentUpload) {
    throw new Error('Parent upload not found')
  }

  const upload = await uploadsRepository.createUploadEntry(
    v4(),
    UploadType.FOLDER,
    UploadStatus.MIGRATING,
    fileTree.name,
    fileTree,
    null,
    rootId,
    fileTree.id,
    parentUpload.oauth_provider,
    parentUpload.oauth_user_id,
    null,
  )

  return mapTableToModel(upload) as FolderUpload
}

const getPendingMigrations = async (limit: number): Promise<UploadEntry[]> => {
  const pendingMigrations = await uploadsRepository.getUploadsByStatus(
    UploadStatus.MIGRATING,
    limit,
  )

  return pendingMigrations
}

const scheduleNodeMigration = async (uploadId: string): Promise<void> => {
  const tasks: Task[] = [
    createTask({
      id: 'migrate-upload-nodes',
      params: {
        uploadId,
      },
    }),
  ]
  EventRouter.publish(tasks)
}

const removeUploadArtifacts = async (uploadId: string): Promise<void> => {
  await blockstoreRepository.deleteBlockstoreEntries(uploadId)
  await uploadsRepository.deleteEntriesByRootUploadId(uploadId)
  await filePartsRepository.deleteChunksByUploadId(uploadId)
  await fileProcessingInfoRepository.deleteFileProcessingInfo(uploadId)
}

const PUBLISH_BATCH_SIZE = 50

const scheduleNodesPublish = async (cid: string): Promise<void> => {
  const nodes = await NodesUseCases.getCidsByRootCid(cid)

  for (let i = 0; i < nodes.length; i += PUBLISH_BATCH_SIZE) {
    const batch = nodes.slice(i, i + PUBLISH_BATCH_SIZE)
    EventRouter.publish(
      createTask({
        id: 'publish-nodes',
        params: { nodes: batch },
      }),
    )
  }
}

const scheduleUploadTagging = async (cid: string): Promise<void> => {
  const tasks: Task[] = [
    createTask({
      id: 'tag-upload',
      params: {
        cid,
      },
    }),
  ]

  EventRouter.publish(tasks)
}

const tagUpload = async (
  cid: string,
  isRoot: boolean = true,
): Promise<Result<void, ObjectNotFoundError>> => {
  const getResult = await ObjectUseCases.getMetadata(cid)
  if (getResult.isErr()) {
    logger.error('Failed to get metadata for upload (cid=%s)', cid)
    return err(getResult.error)
  }

  const metadata = getResult.value
  if (metadata?.type === 'folder') {
    const results = await Promise.all(
      metadata.children.map((child) =>
        UploadsUseCases.tagUpload(child.cid, false),
      ),
    )
    const combinedResult = Result.combine(results)
    if (combinedResult.isErr()) {
      logger.error(
        'Failed to tag upload (cid=%s) due to error: %s',
        cid,
        combinedResult.error.message,
      )
      return err(combinedResult.error)
    }
  } else {
    const fileExtension = metadata?.name?.split('.').pop()
    const isFileInsecure =
      fileExtension &&
      config.params.forbiddenExtensions.some((ext) => ext.match(fileExtension))
    if (isFileInsecure) {
      await ObjectUseCases.addTag(cid, 'insecure')
    }
  }

  if (isRoot) {
    await scheduleNodesPublish(cid)
  }

  return ok()
}

const scheduleCachePopulation = async (cid: string): Promise<void> => {
  const tasks: Task[] = [
    createTask({
      id: 'populate-cache',
      params: { cid },
    }),
  ]
  EventRouter.publish(tasks)
}

const processMigration = async (uploadId: string): Promise<void> => {
  logger.debug('processMigration invoked (uploadId=%s)', uploadId)
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    logger.error('Upload not found (uploadId=%s)', uploadId)
    throw new Error('Upload not found')
  }

  const cid = await BlockstoreUseCases.getUploadCID(uploadId)
  await NodesUseCases.migrateFromBlockstoreToNodesTable(uploadId)

  await removeUploadArtifacts(uploadId)
  await scheduleUploadTagging(cidToString(cid))
  await scheduleCachePopulation(cidToString(cid))
}

export const UploadsUseCases = {
  createFileUpload,
  createFolderUpload,
  createFileInFolder,
  uploadChunk,
  completeUpload,
  getFileFromFolderUpload,
  getPendingMigrations,
  processMigration,
  createSubFolderUpload,
  scheduleNodesPublish,
  scheduleUploadTagging,
  tagUpload,
}
