import {
  ChunkInfo,
  cidToString,
  DEFAULT_MAX_LINK_PER_NODE,
  MetadataType,
  processFolderToIPLDFormat,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { blockstoreRepository } from '../../repositories/uploads/index.js'
import { CID } from 'multiformats'
import {
  FolderUpload,
  Upload,
  UploadStatus,
  UploadType,
  FolderTreeFolder,
} from '@auto-drive/models'
import { UploadsUseCases } from './uploads.js'
import { getUploadBlockstore } from '../../services/upload/uploadProcessorCache/index.js'
import { uploadsRepository } from '../../repositories/uploads/uploads.js'

const getFileUploadIdCID = async (uploadId: string): Promise<CID> => {
  const blockstoreEntry = await blockstoreRepository.getByType(
    uploadId,
    MetadataType.File,
  )
  if (blockstoreEntry.length !== 1) {
    throw new Error(
      `Invalid number of blockstore entries for file upload with id=${uploadId}`,
    )
  }
  const cid = blockstoreEntry[0].cid

  return stringToCid(cid)
}

const getFolderUploadIdCID = async (uploadId: string): Promise<CID> => {
  const blockstoreEntry = await blockstoreRepository.getByType(
    uploadId,
    MetadataType.Folder,
  )
  if (blockstoreEntry.length !== 1) {
    throw new Error(
      `Invalid number of blockstore entries for folder upload with id=${uploadId}`,
    )
  }
  const cid = blockstoreEntry[0].cid

  return stringToCid(cid)
}

const getUploadCID = async (uploadId: string): Promise<CID> => {
  const uploadEntry = await uploadsRepository.getUploadEntryById(uploadId)
  if (!uploadEntry) {
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
          throw new Error(
            `File upload not found (root_upload_id=${rootUploadId}, relative_id=${child.id})`,
          )
        }

        return getFileUploadIdCID(fileUpload.id)
      }
    }),
  )

  const blockstore = await getUploadBlockstore(currentUpload.id)

  const childrenNodesLengths = await Promise.all(
    childrenCids.map((cid) =>
      blockstoreRepository
        .getByCIDAndRootUploadId(rootUploadId, cidToString(cid))
        .then((e) => {
          if (!e) {
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
  const files = await UploadsUseCases.getFileFromFolderUpload(upload.id)

  const allCompleted = files.every((f) =>
    [UploadStatus.MIGRATING].includes(f.status),
  )
  if (!allCompleted) {
    throw new Error('Not all files are being uploaded')
  }

  const fileTree = upload.fileTree
  return processFileTree(upload.id, upload, fileTree)
}

const getNode = async (cid: string): Promise<Buffer | undefined> => {
  const nodes = await blockstoreRepository.getNodesByCid(cid)
  if (nodes.length === 0) {
    return undefined
  }

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
