import {
  ChunkInfo,
  cidToString,
  DEFAULT_MAX_LINK_PER_NODE,
  MetadataType,
  processFolderToIPLDFormat,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { blockstoreRepository } from '../../infrastructure/repositories/uploads/index.js'
import { CID } from 'multiformats'
import {
  FolderUpload,
  Upload,
  UploadStatus,
  UploadType,
  FolderTreeFolder,
} from '@auto-drive/models'
import { UploadsUseCases } from './uploads.js'
import { getUploadBlockstore } from '../../infrastructure/services/upload/uploadProcessorCache/index.js'
import { uploadsRepository } from '../../infrastructure/repositories/uploads/uploads.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { UnrecoverableUploadError } from './errors.js'

const logger = createLogger('useCases:uploads:blockstore')

/**
 * Resolves the single root node CID an upload's blockstore must contain.
 *
 * Tolerates DUPLICATE rows that all carry the same CID. Historically a repeated
 * completeUpload call re-ran the completion processing and re-INSERTed the root
 * node — uploads.blockstore had only the NON-unique
 * blockstore_upload_id_cid_index on (upload_id, cid) — leaving 2-3 byte-identical
 * rows and making this lookup, and therefore migration, fail permanently for an
 * upload whose data is perfectly intact.
 *
 * Both ends of that are now closed: completeUpload refuses to re-run, and
 * blockstore_root_node_unique_idx makes a duplicate root row unrepresentable. So
 * this tolerance is no longer load-bearing for new writes — it stays because a
 * replica or a rolled-back deploy may still be reading rows written before the
 * migration deduplicated them, and because failing an intact upload permanently
 * is a far worse outcome than picking the single CID they all agree on.
 *
 * Deduplicating on CID rather than row count is safe because it is only used to
 * identify the ROOT node, of which there can be exactly one per upload; the
 * per-chunk reads (getChunksByNodeType, getFilteredMany) are deliberately left
 * alone, since a file containing two identical chunks legitimately stores two
 * rows with the same CID and both links belong in the DAG.
 *
 * A count of zero, or genuinely different CIDs, is not a duplicate — it is an
 * upload that can never produce a root node, so it raises
 * UnrecoverableUploadError rather than a bare Error.
 */
const getRootNodeCID = async (
  uploadId: string,
  nodeType: MetadataType.File | MetadataType.Folder,
): Promise<CID> => {
  const blockstoreEntry = await blockstoreRepository.getByType(
    uploadId,
    nodeType,
  )
  const distinctCids = new Set(blockstoreEntry.map((e) => e.cid))

  if (distinctCids.size !== 1) {
    logger.warn(
      'Invalid number of blockstore entries for %s upload (uploadId=%s, rows=%d, distinctCids=%d)',
      nodeType,
      uploadId,
      blockstoreEntry.length,
      distinctCids.size,
    )
    throw new UnrecoverableUploadError(
      `Invalid number of blockstore entries for ${nodeType} upload with id=${uploadId} (rows=${blockstoreEntry.length}, distinctCids=${distinctCids.size})`,
      uploadId,
    )
  }

  if (blockstoreEntry.length > 1) {
    logger.warn(
      'Duplicate root blockstore rows for %s upload, all with the same CID; using it (uploadId=%s, rows=%d)',
      nodeType,
      uploadId,
      blockstoreEntry.length,
    )
  }

  const [cid] = distinctCids

  return stringToCid(cid)
}

const getFileUploadIdCID = async (uploadId: string): Promise<CID> => {
  logger.debug('getFileUploadIdCID invoked (uploadId=%s)', uploadId)

  return getRootNodeCID(uploadId, MetadataType.File)
}

const getFolderUploadIdCID = async (uploadId: string): Promise<CID> => {
  logger.debug('getFolderUploadIdCID invoked (uploadId=%s)', uploadId)

  return getRootNodeCID(uploadId, MetadataType.Folder)
}

const getUploadCID = async (uploadId: string): Promise<CID> => {
  logger.debug('getUploadCID invoked (uploadId=%s)', uploadId)
  const uploadEntry = await uploadsRepository.getUploadEntryById(uploadId)
  if (!uploadEntry) {
    logger.error('Upload not found (uploadId=%s)', uploadId)
    // Upload rows never come back, so a migrate task for a deleted upload can
    // only ever fail; do not let it retry into the dead-letter queue.
    throw new UnrecoverableUploadError('Upload not found', uploadId)
  }

  if (uploadEntry.type === UploadType.FILE) {
    return getFileUploadIdCID(uploadId)
  } else {
    return getFolderUploadIdCID(uploadId)
  }
}

const getChunksByNodeType = async (
  uploadId: string,
  nodeType: MetadataType,
): Promise<ChunkInfo[]> => {
  logger.debug(
    'getChunksByNodeType invoked (uploadId=%s, nodeType=%s)',
    uploadId,
    nodeType,
  )
  const blockstoreEntries =
    await blockstoreRepository.getBlockstoreEntriesWithoutData(uploadId)

  return blockstoreEntries
    .filter((e) => e.node_type === nodeType)
    .map((block) => ({
      size: BigInt(block.node_size).valueOf(),
      cid: block.cid,
    }))
}

const processFileTree = async (
  rootUploadId: string,
  currentUpload: Upload,
  fileTree: FolderTreeFolder,
): Promise<CID> => {
  logger.debug(
    'processFileTree invoked (rootUploadId=%s, folderName=%s)',
    rootUploadId,
    fileTree.name,
  )
  const childrenCids = await Promise.all(
    fileTree.children.map(async (child) => {
      if (child.type === 'folder') {
        const subfolderUpload = await UploadsUseCases.createSubFolderUpload(
          rootUploadId,
          child,
        )
        return processFileTree(rootUploadId, subfolderUpload, child)
      } else {
        const fileUpload = await uploadsRepository.getUploadEntriesByRelativeId(
          rootUploadId,
          child.id,
        )
        if (!fileUpload) {
          logger.warn(
            'File upload not found (root_upload_id=%s, relative_id=%s)',
            rootUploadId,
            child.id,
          )
          throw new Error(
            `File upload not found (root_upload_id=${rootUploadId}, relative_id=${child.id})`,
          )
        }

        return getFileUploadIdCID(fileUpload.id)
      }
    }),
  )

  logger.trace('processFileTree children CIDs count=%d', childrenCids.length)

  const blockstore = await getUploadBlockstore(currentUpload.id)

  const childrenNodesLengths = await Promise.all(
    childrenCids.map((cid) =>
      blockstoreRepository
        .getByCIDAndRootUploadId(rootUploadId, cidToString(cid))
        .then((e) => {
          if (!e) {
            logger.warn(
              'Blockstore entry not found (root_upload_id=%s, cid=%s)',
              rootUploadId,
              cidToString(cid),
            )
            throw new Error(
              `Blockstore entry not found (root_upload_id=${rootUploadId}, cid=${cidToString(
                cid,
              )})`,
            )
          }
          return e.node_size
        }),
    ),
  )

  const totalSize = childrenNodesLengths.reduce(
    (acc, curr) => acc + BigInt(curr).valueOf(),
    BigInt(0).valueOf(),
  )

  logger.trace('processFileTree totalSize=%d', totalSize)

  return processFolderToIPLDFormat(
    blockstore,
    childrenCids,
    fileTree.name,
    totalSize,
    {
      maxLinkPerNode: DEFAULT_MAX_LINK_PER_NODE,
    },
  )
}

const processFolderUpload = async (upload: FolderUpload): Promise<CID> => {
  logger.debug('processFolderUpload invoked (uploadId=%s)', upload.id)
  const files = await UploadsUseCases.getFileFromFolderUpload(upload.id)

  const allCompleted = files.every((f) =>
    [UploadStatus.MIGRATING].includes(f.status),
  )
  if (!allCompleted) {
    logger.warn('Not all files are being uploaded (uploadId=%s)', upload.id)
    throw new Error('Not all files are being uploaded')
  }

  const fileTree = upload.fileTree
  const cid = await processFileTree(upload.id, upload, fileTree)

  logger.debug(
    'processFolderUpload completed (uploadId=%s, cid=%s)',
    upload.id,
    cidToString(cid),
  )
  return cid
}

const getNode = async (cid: string): Promise<Buffer | undefined> => {
  logger.trace('getNode invoked (cid=%s)', cid)
  const nodes = await blockstoreRepository.getNodesByCid(cid)
  if (nodes.length === 0) {
    return undefined
  }

  logger.trace('getNode retrieved %d nodes', nodes.length)

  const node = nodes[0]

  return Buffer.from(node.data)
}

export const BlockstoreUseCases = {
  getFileUploadIdCID,
  getFolderUploadIdCID,
  getUploadCID,
  getChunksByNodeType,
  processFolderUpload,
  getNode,
}
