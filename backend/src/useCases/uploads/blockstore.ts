import {
  ChunkInfo,
  cidToString,
  MetadataType,
  processFolderToIPLDFormat,
  stringToCid,
} from '@autonomys/auto-drive'
import { blockstoreRepository } from '../../repositories/uploads/index.js'
import { CID } from 'multiformats'
import {
  FolderUpload,
  Upload,
  UploadOptions,
  UploadStatus,
  UploadType,
} from '../../models/uploads/upload.js'
import { UploadsUseCases } from './uploads.js'
import { FolderTreeFolder } from '../../models/objects/index.js'
import { getUploadBlockstore } from '../../services/uploadProcessorCache/index.js'
import { uploadsRepository } from '../../repositories/uploads/uploads.js'

const getFileUploadIdCID = async (uploadId: string): Promise<CID> => {
  const blockstoreEntry = await blockstoreRepository.getByType(
    uploadId,
    MetadataType.File,
  )
  if (blockstoreEntry.length !== 1) {
    throw new Error('Invalid number of blockstore entries')
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
    throw new Error('Invalid number of blockstore entries')
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
      size: block.node_size,
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

  const totalSize = childrenNodesLengths.reduce((acc, curr) => acc + curr, 0)

  const uploadOptions: Partial<UploadOptions> = {
    ...currentUpload.uploadOptions,
  }

  return processFolderToIPLDFormat(
    blockstore,
    childrenCids,
    fileTree.name,
    totalSize,
    uploadOptions,
  )
}

const processFolderUpload = async (upload: FolderUpload): Promise<CID> => {
  const files = await UploadsUseCases.getFileFromFolderUpload(upload.id)

  const allCompleted = files.every((f) =>
    [UploadStatus.COMPLETED, UploadStatus.MIGRATING].includes(f.status),
  )
  if (!allCompleted) {
    throw new Error('Not all files are being uploaded')
  }

  const fileTree = upload.fileTree
  return processFileTree(upload.id, upload, fileTree)
}

export const BlockstoreUseCases = {
  getFileUploadIdCID,
  getFolderUploadIdCID,
  getUploadCID,
  getChunksByNodeType,
  processFolderUpload,
}
