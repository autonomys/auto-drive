import {
  FileArtifacts,
  FolderArtifacts,
  UploadArtifacts,
  UploadType,
} from '@auto-drive/models'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { uploadsRepository } from '../../infrastructure/repositories/uploads/uploads.js'
import { BlockstoreUseCases } from './blockstore.js'
import {
  fileMetadata,
  folderMetadata,
  MetadataType,
} from '@autonomys/auto-dag-data'

const logger = createLogger('useCases:uploads:artifacts')

const generateFileArtifacts = async (
  uploadId: string,
): Promise<FileArtifacts> => {
  logger.debug('generateFileArtifacts called (uploadId=%s)', uploadId)
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    logger.error('Upload not found (uploadId=%s)', uploadId)
    throw new Error('Upload not found')
  }
  if (upload.type !== UploadType.FILE) {
    logger.error('Upload is not a file (uploadId=%s)', uploadId)
    throw new Error('Upload is not a file')
  }

  const cid = await BlockstoreUseCases.getFileUploadIdCID(uploadId)
  logger.trace('Resolved file CID (uploadId=%s, cid=%s)', uploadId, cid)

  let chunks = await BlockstoreUseCases.getChunksByNodeType(
    uploadId,
    MetadataType.FileChunk,
  )
  if (chunks.length === 0) {
    chunks = await BlockstoreUseCases.getChunksByNodeType(
      uploadId,
      MetadataType.File,
    )
  }

  const totalSize = chunks.reduce(
    (acc, e) => acc + e.size.valueOf(),
    BigInt(0).valueOf(),
  )

  const metadata = fileMetadata(
    cid,
    chunks,
    totalSize,
    upload.name,
    upload.mime_type,
    upload.upload_options ?? undefined,
  )

  logger.debug('File metadata generated (cid=%s, totalSize=%d)', cid, totalSize)
  return {
    metadata,
  }
}

const generateFolderArtifacts = async (
  uploadId: string,
): Promise<FolderArtifacts> => {
  logger.debug('generateFolderArtifacts called (uploadId=%s)', uploadId)
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    logger.error('Upload not found (uploadId=%s)', uploadId)
    throw new Error('Upload not found')
  }
  if (upload.type !== UploadType.FOLDER) {
    logger.error('Upload is not a folder (uploadId=%s)', uploadId)
    throw new Error('Upload is not a folder')
  }
  if (!upload.file_tree) {
    throw new Error('Upload has no file tree')
  }

  const childrenUploads = await Promise.all(
    upload.file_tree.children.map((e) =>
      uploadsRepository
        .getUploadEntriesByRelativeId(upload.root_upload_id, e.id)
        .then((upload) => {
          if (!upload) {
            throw new Error(`Upload with relative ID ${e.id} not found`)
          }
          return upload
        }),
    ),
  )

  const folderCID = await BlockstoreUseCases.getUploadCID(uploadId)

  const childrenArtifacts = await Promise.all(
    childrenUploads.map((e) => generateArtifacts(e.id)),
  )

  const childrenMetadata = childrenArtifacts.map((e) => ({
    cid: e.metadata.dataCid,
    name: e.metadata.name,
    type: e.metadata.type,
    totalSize: e.metadata.totalSize,
  }))

  const metadata = folderMetadata(
    folderCID,
    childrenMetadata,
    upload.name,
    upload.upload_options ?? undefined,
  )

  logger.debug(
    'Folder metadata generated (cid=%s, children=%d)',
    metadata.dataCid,
    childrenMetadata.length,
  )
  return {
    metadata,
    childrenArtifacts,
  }
}

const generateArtifacts = async (
  uploadId: string,
): Promise<UploadArtifacts> => {
  logger.debug('generateArtifacts called (uploadId=%s)', uploadId)
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    logger.error('Upload not found (uploadId=%s)', uploadId)
    throw new Error('Upload not found')
  }
  return upload.type === UploadType.FILE
    ? generateFileArtifacts(uploadId)
    : generateFolderArtifacts(uploadId)
}

export const UploadArtifactsUseCase = {
  generateArtifacts,
  generateFileArtifacts,
  generateFolderArtifacts,
}
