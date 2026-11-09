import { encode } from '@ipld/dag-pb'
import { BaseBlockstore } from 'blockstore-core'
import pg from 'pg'
import {
  FileProcessingInfo,
  fileProcessingInfoRepository,
} from '../../infrastructure/repositories/uploads/fileProcessingInfo.js'
import { getUploadBlockstore } from '../../infrastructure/services/upload/uploadProcessorCache/index.js'
import { toBlockstoreRow } from '../../infrastructure/services/upload/uploadProcessorCache/blockstore.js'
import { withTransaction } from '../../infrastructure/drivers/pg.js'
import {
  cidOfNode,
  cidToString,
  createFileChunkIpldNode,
  DEFAULT_MAX_CHUNK_SIZE,
  DEFAULT_MAX_LINK_PER_NODE,
  fileBuilders,
  MetadataType,
  processBufferToIPLDFormatFromChunks,
  processChunksToIPLDFormat,
  OffchainMetadata,
} from '@autonomys/auto-dag-data'
import {
  blockstoreRepository,
  ChunkEntry,
} from '../../infrastructure/repositories/uploads/blockstore.js'
import {
  FolderUpload,
  InteractionType,
  UploadType,
  UserWithOrganization,
  UploadArtifacts,
  FolderArtifacts,
} from '@auto-drive/models'
import { BlockstoreUseCases } from './blockstore.js'
import { mapTableToModel } from './uploads.js'
import {
  UploadEntry,
  uploadsRepository,
} from '../../infrastructure/repositories/uploads/uploads.js'
import { ObjectUseCases } from '../objects/object.js'
import { OwnershipUseCases } from '../objects/ownership.js'
import { filePartsRepository } from '../../infrastructure/repositories/uploads/fileParts.js'
import { UploadArtifactsUseCase } from './artifacts.js'
import { CID } from 'multiformats'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { AccountsUseCases } from '../users/accounts.js'
import { UploadPartsChangedError } from './errors.js'
import { BadRequestError, PaymentRequiredError } from '../../errors/index.js'

const logger = createLogger('useCases:uploads:uploadProcessing')

const getUnprocessedChunkFromLatestFilePart = async (
  fileProcessingInfo: FileProcessingInfo,
): Promise<Buffer> => {
  return fileProcessingInfo.pending_bytes ?? Buffer.alloc(0)
}

/**
 * Runs `fn` in a transaction holding the upload's file_processing_info row lock.
 * The lock serialises every step that reads or advances the processing cursor
 * (storing a part, processing a part, deriving the root) across processes, and
 * the transaction makes each step all-or-nothing, so a failure part-way leaves
 * nothing behind for a retry to duplicate.
 *
 * `fn` must run every query on `client`. A pool query from inside would wait
 * for a second connection while holding this one, and enough concurrent callers
 * would exhaust the pool and wait on each other forever.
 */
const withFileProcessingLock = async <T>(
  uploadId: string,
  fn: (client: pg.PoolClient, info: FileProcessingInfo) => Promise<T>,
): Promise<T> =>
  withTransaction(async (client) => {
    const info =
      await fileProcessingInfoRepository.getFileProcessingInfoForUpdate(
        client,
        uploadId,
      )
    if (!info) {
      logger.error('File processing info not found (uploadId=%s)', uploadId)
      throw new Error('File processing info not found')
    }
    return fn(client, info)
  })

// Keeps a part's chunk nodes in memory, in order, as blockstore rows, so they
// are written with addChunkEntries inside the part's transaction.
// processChunksToIPLDFormat only calls put(); anything else rejects
// (BaseBlockstore's default).
class ChunkCollector extends BaseBlockstore {
  readonly rows: ChunkEntry[] = []

  async put(cid: CID, block: Uint8Array): Promise<CID> {
    this.rows.push(toBlockstoreRow(cid, block))
    return cid
  }
}

/**
 * Processes part `index` from `data`: chunks it after the pending tail, writes
 * its chunk nodes and advances the cursor, all on `client`. The caller must
 * hold withFileProcessingLock, and `index` must be the part after the cursor.
 */
const processPart = async (
  client: pg.PoolClient,
  fileProcessingInfo: FileProcessingInfo,
  index: number,
  data: Buffer,
): Promise<void> => {
  const { upload_id: uploadId } = fileProcessingInfo
  logger.trace('Processing part (uploadId=%s, partIndex=%d)', uploadId, index)
  const latestPartLeftOver =
    await getUnprocessedChunkFromLatestFilePart(fileProcessingInfo)

  const collector = new ChunkCollector()
  const leftOver = await processChunksToIPLDFormat(
    collector,
    [latestPartLeftOver, data],
    fileBuilders,
  )
  await blockstoreRepository.addChunkEntries(uploadId, collector.rows, client)

  await fileProcessingInfoRepository.updateFileProcessingInfo(
    {
      ...fileProcessingInfo,
      last_processed_part_index: index,
      pending_bytes: leftOver,
    },
    client,
  )
}

/**
 * Processes the next part in sequence if it is stored, and returns whether it
 * did. The part is read, its chunk nodes written and the cursor advanced in one
 * transaction under the row lock, so a part is processed exactly once even when
 * two processes drain the same upload, and a failure leaves the upload as if
 * the part had never been processed.
 */
const processNextPart = async (uploadId: string): Promise<boolean> =>
  withFileProcessingLock(uploadId, async (client, fileProcessingInfo) => {
    const lastProcessedPartIndex = fileProcessingInfo.last_processed_part_index
    const index =
      lastProcessedPartIndex == null ? 0 : lastProcessedPartIndex + 1
    const part = await filePartsRepository.getChunkByUploadIdAndPartIndex(
      uploadId,
      index,
      client,
    )
    if (!part) {
      return false
    }

    await processPart(client, fileProcessingInfo, index, part.data)
    return true
  })

// Throws if any stored part sits beyond the processed cursor. Such a gap would
// make getUploadFilePartsSize count bytes that were never written to the IPLD
// tree, so the assembled object's size would not match its content.
const assertNoUnprocessedParts = async (
  client: pg.PoolClient,
  uploadId: string,
  fileProcessingInfo: FileProcessingInfo,
): Promise<void> => {
  const lastProcessed = fileProcessingInfo.last_processed_part_index ?? -1
  // Index-only query: avoids loading the (potentially multi-GB) data column.
  const unprocessed = await filePartsRepository.getPartIndicesGreaterThan(
    uploadId,
    lastProcessed,
    client,
  )
  if (unprocessed.length > 0) {
    throw new BadRequestError(
      `Cannot complete upload: parts stored but not processed (gap in sequence) at part_index=[${unprocessed.join(',')}]`,
    )
  }
}

const completeFileProcessing = async (uploadId: string): Promise<CID> => {
  logger.debug('completeFileProcessing invoked (uploadId=%s)', uploadId)
  // Read before taking the lock: inside it, every query runs on its client.
  const upload = await uploadsRepository.getUploadEntryById(uploadId)

  // Under the row lock that part processing takes, in one transaction: a part
  // arriving concurrently is either processed before the gap check below or
  // waits for the lock and is then refused, since completion has claimed the
  // upload (see uploadChunk); and a failure part-way through, including inside
  // the chunker's destructive single-chunk path, rolls back to the state before
  // completion started.
  return withFileProcessingLock(uploadId, (client, fileProcessingInfo) =>
    deriveFileRoot(client, uploadId, upload, fileProcessingInfo),
  )
}

const deriveFileRoot = async (
  client: pg.PoolClient,
  uploadId: string,
  upload: UploadEntry | null,
  fileProcessingInfo: FileProcessingInfo,
): Promise<CID> => {
  await assertNoUnprocessedParts(client, uploadId, fileProcessingInfo)

  // Derivation runs AT MOST ONCE per upload, and re-entry returns the root node
  // the first run produced.
  //
  // This is not an optimisation, it is a correctness requirement:
  // processBufferToIPLDFormatFromChunks is DESTRUCTIVE. For a single-chunk file it
  // does get -> delete -> put(root) (auto-dag-data chunker.ts), so the chunk it
  // folded in is gone afterwards. Re-deriving therefore does not reproduce the
  // first result — it builds a root over whatever chunks remain and yields a
  // DIFFERENT CID, which is the unrecoverable shape: getRootNodeCID refuses two
  // distinct root CIDs, so every later retry 500s and appends another root row.
  //
  // Re-entry is entirely reachable: completeUpload releases its claim back to
  // PENDING when completion fails, and the documented failure — `Not enough
  // upload credits`, thrown by handleFileUploadFinalization — happens strictly
  // AFTER this derivation. The advertised "top up and retry" flow is exactly this
  // path, so it has to resume rather than restart.
  const existingRootNodes = await blockstoreRepository.getByType(
    uploadId,
    MetadataType.File,
    client,
  )
  if (existingRootNodes.length > 0) {
    // Delegates rather than reading [0] so duplicate-but-identical rows are
    // tolerated and genuinely divergent ones still raise UnrecoverableUploadError.
    const existingCid = await BlockstoreUseCases.getFileUploadIdCID(
      uploadId,
      client,
    )

    // Reuse is only correct while the upload still holds the bytes the root was
    // built from, and that can stop being true between the two calls. The failed
    // completion above released the row back to PENDING, so uploadChunk accepts
    // parts again, and S3 permits UploadPart after a failed
    // CompleteMultipartUpload — so `part A, failed complete, part B, complete` is
    // legal at every step.
    // Returning the existing root there answers 200 with a CID covering A alone,
    // and on the S3 route the composite ETag is computed from the client's part
    // list, so the mapping would store an ETag that does not describe the stored
    // object. Loud-and-unrecoverable was the wrong answer to a retry, but
    // silently truncating an object the client stores and references is a worse
    // one in a content-addressed store.
    //
    // Detected by size because the root node's size IS the uploadedSize it was
    // derived from, so one aggregate query over the stored parts settles it.
    const derivedSize = BigInt(existingRootNodes[0].node_size).valueOf()
    const storedSize =
      (await filePartsRepository.getUploadFilePartsSize(uploadId, client)) ??
      BigInt(0).valueOf()
    if (storedSize !== derivedSize) {
      logger.error(
        'Stored parts no longer match the derived root node (uploadId=%s, cid=%s, derivedSize=%s, storedSize=%s)',
        uploadId,
        cidToString(existingCid),
        derivedSize.toString(),
        storedSize.toString(),
      )
      throw new UploadPartsChangedError(
        `Upload ${uploadId} has ${storedSize} bytes of parts stored but its root node covers ${derivedSize}; parts changed after the root node was derived. Abort the upload and start again.`,
        uploadId,
      )
    }

    logger.warn(
      'Reusing the already-derived root node instead of re-deriving (uploadId=%s, cid=%s)',
      uploadId,
      cidToString(existingCid),
    )
    return existingCid
  }

  const blockstore = await getUploadBlockstore(uploadId, client)
  const latestPartLeftOver =
    await getUnprocessedChunkFromLatestFilePart(fileProcessingInfo)

  if (latestPartLeftOver.byteLength > 0) {
    const fileChunk = createFileChunkIpldNode(latestPartLeftOver)
    await blockstore.put(cidOfNode(fileChunk), encode(fileChunk))
    // Consume the tail, in the same transaction as the put and the derivation,
    // so the tail is never both flushed and still pending: anything that read
    // it again would put a second copy and give the DAG a duplicate link.
    await fileProcessingInfoRepository.updateFileProcessingInfo(
      {
        ...fileProcessingInfo,
        pending_bytes: null,
      },
      client,
    )
  }

  const uploadedSize =
    (await filePartsRepository.getUploadFilePartsSize(uploadId, client)) ??
    BigInt(0).valueOf()

  const uploadOptions = {
    maxLinkPerNode: DEFAULT_MAX_LINK_PER_NODE,
    maxChunkSize: DEFAULT_MAX_CHUNK_SIZE,
    ...(upload?.upload_options ?? {}),
  }

  const cidOfNodeId = await processBufferToIPLDFormatFromChunks(
    blockstore,
    blockstore.getFilteredMany(MetadataType.FileChunk),
    upload?.name,
    uploadedSize,
    fileBuilders,
    uploadOptions,
  )

  logger.debug(
    'File processing completed (uploadId=%s, cid=%s)',
    uploadId,
    cidOfNodeId,
  )

  return cidOfNodeId
}

const completeUploadProcessing = async (upload: UploadEntry): Promise<CID> => {
  logger.debug(
    'completeUploadProcessing invoked (uploadId=%s, type=%s)',
    upload.id,
    upload.type,
  )
  if (upload.type === UploadType.FILE) {
    return completeFileProcessing(upload.id)
  } else if (upload.type === UploadType.FOLDER) {
    return BlockstoreUseCases.processFolderUpload(
      mapTableToModel(upload) as FolderUpload,
    )
  } else {
    logger.error(
      'Invalid upload type (uploadId=%s, type=%s)',
      upload.id,
      upload.type,
    )
    throw new Error('Invalid upload type')
  }
}

const handleFileUploadFinalization = async (
  user: UserWithOrganization,
  uploadId: string,
): Promise<string> => {
  logger.debug(
    'handleFileUploadFinalization called (uploadId=%s, userId=%s)',
    uploadId,
    user.oauthUserId,
  )
  const pendingCredits = await AccountsUseCases.getPendingCreditsByUserAndType(
    user,
    InteractionType.Upload,
  )
  const { metadata } =
    await UploadArtifactsUseCase.generateFileArtifacts(uploadId)
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (pendingCredits < metadata.totalSize) {
    throw new PaymentRequiredError('Not enough upload credits')
  }

  await OwnershipUseCases.setUserAsAdmin(user, metadata.dataCid)

  const isRootUpload = upload?.root_upload_id === uploadId
  if (isRootUpload) {
    await ObjectUseCases.saveMetadata(
      metadata.dataCid,
      metadata.dataCid,
      metadata,
    )
  }

  await AccountsUseCases.registerInteraction(
    user,
    InteractionType.Upload,
    metadata.totalSize.valueOf(),
    metadata.dataCid,
  )

  logger.info(
    'handleFileUploadFinalization completed (cid=%s, userId=%s)',
    metadata.dataCid,
    user.oauthUserId,
  )
  return metadata.dataCid
}

const flattenArtifacts = (artifact: UploadArtifacts): OffchainMetadata[] => {
  const collected: OffchainMetadata[] = [artifact.metadata]
  if ((artifact as FolderArtifacts).childrenArtifacts) {
    const folder = artifact as FolderArtifacts
    for (const child of folder.childrenArtifacts) {
      collected.push(...flattenArtifacts(child))
    }
  }
  return collected
}

const handleFolderUploadFinalization = async (
  user: UserWithOrganization,
  uploadId: string,
): Promise<string> => {
  logger.debug(
    'handleFolderUploadFinalization called (uploadId=%s, userId=%s)',
    uploadId,
    user.oauthUserId,
  )

  // Credit guard: verify the user has a non-negative credit balance before
  // finalising the folder DAG structure.
  //
  // NOTE: Each child file upload is individually finalised via
  // handleFileUploadFinalization, which calls registerInteraction and deducts
  // the file's bytes from the user's credit pool. By the time this function
  // runs, all child credit deductions have already been committed.
  //
  // The folder root itself is a small IPLD directory node whose
  // metadata.totalSize equals the SUM of its children's totalSize values — it
  // carries no independent byte cost beyond what the children already paid for.
  // Calling registerInteraction(metadata.totalSize) here would therefore
  // double-charge the user for all folder content, which is incorrect.
  //
  // Instead we perform a guard-only check: if the balance has somehow gone
  // negative (which should never happen under normal operation) we surface the
  // error early rather than silently producing an inconsistent folder object.
  const pendingCredits = await AccountsUseCases.getPendingCreditsByUserAndType(
    user,
    InteractionType.Upload,
  )
  if (pendingCredits < 0) {
    throw new Error('Insufficient upload credits')
  }

  const { metadata, childrenArtifacts } =
    await UploadArtifactsUseCase.generateFolderArtifacts(uploadId)

  const allMetadata: OffchainMetadata[] = [
    metadata,
    ...childrenArtifacts.flatMap((child) => flattenArtifacts(child)),
  ]

  await Promise.all(
    allMetadata.map((childMetadata) =>
      ObjectUseCases.saveMetadata(
        metadata.dataCid,
        childMetadata.dataCid,
        childMetadata,
      ),
    ),
  )

  await OwnershipUseCases.setUserAsAdmin(user, metadata.dataCid)

  logger.info(
    'handleFolderUploadFinalization completed (cid=%s, userId=%s)',
    metadata.dataCid,
    user.oauthUserId,
  )
  return metadata.dataCid
}

export const UploadFileProcessingUseCase = {
  withFileProcessingLock,
  processPart,
  processNextPart,
  completeUploadProcessing,
  handleFileUploadFinalization,
  handleFolderUploadFinalization,
}
