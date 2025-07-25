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

const logger = createLogger('useCases:uploads:blockstore')

const getFileUploadIdCID = async (uploadId: string): Promise<CID> => {
  logger.debug('getFileUploadIdCID invoked (uploadId=%s)', uploadId)
  const blockstoreEntry = await blockstoreRepository.getByType(
    uploadId,
    MetadataType.File,
  )
  if (blockstoreEntry.length !== 1) {
    logger.warn(
      'Invalid number of blockstore entries for file upload (uploadId=%s)',
      uploadId,
    )
    throw new Error(
      `Invalid number of blockstore entries for file upload with id=${uploadId}`,
    )
  }
  const cid = blockstoreEntry[0].cid

  return stringToCid(cid)
}

const getFolderUploadIdCID = async (uploadId: string): Promise<CID> => {
  logger.debug('getFolderUploadIdCID invoked (uploadId=%s)', uploadId)
  const blockstoreEntry = await blockstoreRepository.getByType(
    uploadId,
    MetadataType.Folder,
  )
  if (blockstoreEntry.length !== 1) {
    logger.warn(
      'Invalid number of blockstore entries for folder upload (uploadId=%s)',
      uploadId,
    )
    throw new Error(
      `Invalid number of blockstore entries for folder upload with id=${uploadId}`,
    )
  }
  const cid = blockstoreEntry[0].cid

  return stringToCid(cid)
}

const getUploadCID = async (uploadId: string): Promise<CID> => {
  logger.debug('getUploadCID invoked (uploadId=%s)', uploadId)
  const uploadEntry = await uploadsRepository.getUploadEntryById(uploadId)
  if (!uploadEntry) {
    logger.error('Upload not found (uploadId=%s)', uploadId)
    throw new Error('Upload not found')
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
