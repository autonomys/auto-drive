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
import {
  BadRequestError,
  ForbiddenError,
  ObjectNotFoundError,
} from '../../errors/index.js'
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

// Serialises drains per upload_id: concurrent runs would race on the shared
// last_processed_part_index cursor and double-process or skip chunks.
// In-process only — does not serialise across multiple server processes.
const drainLocks = new Map<string, Promise<unknown>>()

const withDrainLock = async <T>(
  uploadId: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const previous = drainLocks.get(uploadId) ?? Promise.resolve()
  // catch() so a prior caller's rejection does not propagate into this chain.
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

// Processes the contiguous run of stored chunks from last_processed_part_index
// + 1, stopping at the first missing index (parts may arrive out of order).
// Caller must hold withDrainLock: it reads and advances the shared cursor.
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

// Throws if any stored part sits beyond the processed cursor. Such a gap would
// make getUploadFilePartsSize count bytes that were never written to the IPLD
// tree, so the assembled object's size would not match its content.
// Caller must hold withDrainLock so the cursor read is stable.
const assertNoUnprocessedParts = async (uploadId: string): Promise<void> => {
  const info =
    await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(uploadId)
  const lastProcessed = info?.last_processed_part_index ?? -1
  // Index-only query: avoids loading the (potentially multi-GB) data column.
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

  // Guard, store and drain run under one lock so concurrent uploads of the
  // same part_index cannot both read a pre-processing cursor and race the
  // store against the drain. Serialises per upload_id; distinct uploads stay
  // parallel.
  await withDrainLock(uploadId, async () => {
    const info =
      await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(
        uploadId,
      )
    const lastProcessed = info?.last_processed_part_index ?? -1

    // An already-processed part is immutable — the streaming model cannot
    // replace bytes already in the tree. An identical re-upload is a no-op; a
    // divergent one is rejected rather than left inconsistent with the stored
    // object (whose CID still reflects the original bytes).
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
      return
    }

    // Stored at its declared position (PK is upload_id, part_index), so arrival
    // order does not matter; the drain then processes whatever run is ready.
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

  // FILE uploads: drain any not-yet-processed chunks and reject on a gap before
  // finalising. Folder uploads have no file_processing_info row and finalise
  // via processFolderUpload instead. Both steps share one lock; the lockless
  // helpers are used because the lock-acquiring path would deadlock here
  // (withDrainLock is not reentrant).
  if (upload.type === UploadType.FILE) {
    await withDrainLock(uploadId, async () => {
      await drainLoop(uploadId)
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

/**
 * Abort an in-progress upload (S3 AbortMultipartUpload / rclone CleanUp),
 * discarding its buffered parts and blockstore/processing artifacts before it is
 * finalized into an object. Permission-checked against the requesting user.
 * Returns ObjectNotFoundError when the upload id is unknown (NoSuchUpload).
 */
const abortUpload = async (
  user: UserWithOrganization,
  uploadId: string,
): Promise<Result<void, ObjectNotFoundError | ForbiddenError>> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    return err(new ObjectNotFoundError('Upload not found'))
  }
  // Ownership check returned (not thrown) so a cross-user abort surfaces as a
  // typed 403, not a 500 from checkPermissions' plain throw.
  if (
    upload.oauth_provider !== user.oauthProvider ||
    upload.oauth_user_id !== user.oauthUserId
  ) {
    return err(
      new ForbiddenError('User does not have permission to abort this upload'),
    )
  }

  // removeUploadArtifacts deletes the blockstore entries, the upload rows keyed
  // by this root_upload_id (a standalone file upload is its own root), the
  // buffered file parts, and the file-processing-info row.
  await removeUploadArtifacts(uploadId)
  logger.info('Aborted multipart upload (uploadId=%s)', uploadId)
  return ok()
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
  abortUpload,
  getFileFromFolderUpload,
  getPendingMigrations,
  processMigration,
  createSubFolderUpload,
  scheduleNodesPublish,
  scheduleUploadTagging,
  tagUpload,
}
