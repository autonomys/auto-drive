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
import { CID } from 'multiformats'
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
import { UnrecoverableUploadError } from './errors.js'

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

  // completeUpload is NOT idempotent, so it must run at most once per upload.
  // completeUploadProcessing re-derives the root IPLD node and writes it to
  // uploads.blockstore on every call (blockstore.put -> plain INSERT, no unique
  // key on (upload_id, cid)), and handleFileUploadFinalization re-runs
  // registerInteraction. A second call therefore leaves a duplicate root node —
  // which used to make getFileUploadIdCID, and so every future migration
  // attempt, fail permanently — and double-charges upload credits. A client
  // retry after a timeout, a double submit, or a proxy retry is enough to
  // trigger it; only `abortUpload` guarded its status before this.
  //
  // A repeat call on an already-completed upload is treated as a no-op that
  // returns the existing CID, and re-drives migration in case the original
  // one-shot migrate task was lost — the retry heals the upload instead of
  // corrupting it.
  if (upload.status === UploadStatus.MIGRATING) {
    return resolveAlreadyCompletedUpload(upload, uploadId)
  }
  if (
    upload.status !== UploadStatus.PENDING &&
    upload.status !== UploadStatus.COMPLETING
  ) {
    logger.warn(
      'completeUpload called on a %s upload (uploadId=%s)',
      upload.status,
      uploadId,
    )
    throw new Error(`Upload ${uploadId} is ${upload.status}`)
  }

  // The status read above is not a guard on its own — two overlapping calls
  // would both see PENDING and both fall through. Take the claim atomically so
  // exactly one caller runs the processing, across every API process.
  const claimed = await uploadsRepository.claimUploadForCompletion(
    uploadId,
    config.uploads.completionClaimStaleMs,
  )
  if (!claimed) {
    // Losing the claim does not necessarily mean a completion is still running:
    // the winner may have finished the whole thing between the status read above
    // and this compare-and-swap, which for a small upload is an easy window to
    // hit. Re-read before erroring so a retry of an already-successful
    // completion still gets its CID instead of a spurious failure.
    const current = await uploadsRepository.getUploadEntryById(uploadId)
    if (!current) {
      logger.warn('Upload not found (uploadId=%s)', uploadId)
      throw new Error('Upload not found')
    }
    if (current.status === UploadStatus.MIGRATING) {
      return resolveAlreadyCompletedUpload(current, uploadId)
    }
    logger.warn(
      'completeUpload could not claim the upload (uploadId=%s, status=%s)',
      uploadId,
      current.status,
    )
    throw new BadRequestError(
      `Upload ${uploadId} is already being completed; retry once it finishes`,
    )
  }

  try {
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

    const cid =
      await UploadFileProcessingUseCase.completeUploadProcessing(upload)

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

    return await finalizeCompletedUpload(upload, uploadId, cid)
  } catch (error) {
    // Hand the upload back so the client can retry — a failed completion (e.g.
    // insufficient credits, or a gap in the stored parts) must not leave the row
    // parked in COMPLETING, which nothing sweeps. Only rolls back rows still in
    // COMPLETING, so a failure after the flip to MIGRATING cannot undo it.
    await uploadsRepository
      .releaseUploadCompletionClaim(uploadId)
      .catch((releaseError) =>
        logger.error(
          releaseError as Error,
          'Failed to release completion claim (uploadId=%s)',
          uploadId,
        ),
      )
    throw error
  }
}

// A repeat completeUpload call for an upload that already finished is a no-op
// that returns the existing CID, and re-drives migration in case the original
// one-shot migrate task was lost — so the retry heals the upload instead of
// corrupting it. Reached both when the status read sees MIGRATING and when the
// completion claim is lost to a winner that has already finished.
const resolveAlreadyCompletedUpload = async (
  upload: UploadEntry,
  uploadId: string,
): Promise<string> => {
  const cid = cidToString(await BlockstoreUseCases.getUploadCID(uploadId))
  logger.warn(
    'completeUpload called on an already-completed upload; re-driving migration (uploadId=%s, cid=%s)',
    uploadId,
    cid,
  )
  if (upload.root_upload_id === uploadId) {
    await scheduleNodeMigration(uploadId)
  }
  return cid
}

const finalizeCompletedUpload = async (
  upload: UploadEntry,
  uploadId: string,
  cid: CID,
): Promise<string> => {
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
 * Abort an in-progress (PENDING) upload (S3 AbortMultipartUpload / rclone
 * CleanUp), discarding its buffered parts and blockstore/processing artifacts
 * before it is finalized into an object. Permission-checked against the
 * requesting user.
 *
 * Returns ObjectNotFoundError (→ NoSuchUpload) when the id is unknown OR the
 * upload is no longer in progress. Once CompleteMultipartUpload has run the row
 * is MIGRATING and the async migrate-upload-nodes worker still needs the
 * blockstore entries to publish the object's nodes to the DSN — deleting them
 * here would strand a CID the client already holds. S3 clients issue Abort after
 * a successful Complete on retry/cleanup, and per the S3 spec aborting a
 * completed upload returns NoSuchUpload, so this is both safe and spec-correct.
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

  // Only a still-in-progress (PENDING) upload may be aborted. A MIGRATING (or
  // otherwise terminal) upload has already been completed; its artifacts must
  // not be torn down mid-migration.
  if (upload.status !== UploadStatus.PENDING) {
    return err(new ObjectNotFoundError('Upload not found'))
  }

  // removeUploadArtifacts deletes the blockstore entries, the upload rows keyed
  // by this root_upload_id (a standalone file upload is its own root), the
  // buffered file parts, and the file-processing-info row.
  await removeUploadArtifacts(uploadId)
  logger.info('Aborted multipart upload (uploadId=%s)', uploadId)
  return ok()
}

// Serialises processMigration per upload_id within this process, skipping (not
// queueing) a run whose upload is already migrating. A migrate-upload-nodes task
// can be delivered more than once for the same upload — the recovery sweep
// re-drives a still-MIGRATING row — and the task-manager consumer runs up to
// RABBITMQ_PREFETCH handlers concurrently without serialising them. migrate
// clears the root's nodes before re-inserting (see
// migrateFromBlockstoreToNodesTable), which makes a sequential re-drive
// idempotent; this guard covers the concurrent case, where two runs racing that
// delete-then-insert could interleave and drop or duplicate rows (nodes.cid has
// no unique constraint). In-process only, like withDrainLock: the migrate
// consumer (start:fe:worker) runs as a single process, the same single-worker
// invariant on-chain publishing relies on.
const migrationsInFlight = new Set<string>()

const processMigration = async (uploadId: string): Promise<void> => {
  logger.debug('processMigration invoked (uploadId=%s)', uploadId)
  if (migrationsInFlight.has(uploadId)) {
    logger.warn(
      'Migration already in progress for upload %s; skipping concurrent run',
      uploadId,
    )
    return
  }
  migrationsInFlight.add(uploadId)
  try {
    const upload = await uploadsRepository.getUploadEntryById(uploadId)
    if (!upload) {
      logger.error('Upload not found (uploadId=%s)', uploadId)
      throw new UnrecoverableUploadError('Upload not found', uploadId)
    }

    const cid = await BlockstoreUseCases.getUploadCID(uploadId)
    await NodesUseCases.migrateFromBlockstoreToNodesTable(uploadId)

    await removeUploadArtifacts(uploadId)
    await scheduleUploadTagging(cidToString(cid))
    await scheduleCachePopulation(cidToString(cid))
  } catch (error) {
    // A permanently broken upload must not be retried. Left to the normal retry
    // path it would burn its three retries, publish one message to the
    // consumer-less frontend-errors queue, stay MIGRATING, and then be re-driven
    // by the migration recovery sweep on the next staleness window — forever, so
    // the dead-letter queue grows without bound (this is exactly what filled it
    // with 300+ messages). Parking the upload in FAILED takes it out of
    // getStuckRootMigrations, so the sweep stops selecting it, and swallowing the
    // error acks the task instead of dead-lettering it. Mirrors the
    // `unrecoverable` bucket that publishing recovery already logs.
    if (error instanceof UnrecoverableUploadError) {
      logger.error(
        error,
        'Migration is unrecoverable, parking upload as failed (uploadId=%s)',
        uploadId,
      )
      await uploadsRepository
        .updateUploadStatusByRootUploadId(uploadId, UploadStatus.FAILED)
        .catch((updateError) =>
          // Best-effort: if the status write fails the task still acks and the
          // sweep may re-drive it once more, which is strictly better than
          // rethrowing into an unbounded dead-letter loop.
          logger.error(
            updateError as Error,
            'Failed to park unrecoverable upload as failed (uploadId=%s)',
            uploadId,
          ),
        )
      return
    }
    throw error
  } finally {
    migrationsInFlight.delete(uploadId)
  }
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
