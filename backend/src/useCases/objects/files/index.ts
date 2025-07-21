import {
  fileMetadata,
  folderMetadata,
  MetadataType,
  OffchainMetadata,
  ChunkInfo,
} from '@autonomys/auto-dag-data'
import {
  UserWithOrganization,
  InteractionType,
  FileArtifacts,
  FolderArtifacts,
  UploadArtifacts,
  UploadType,
  DownloadServiceOptions,
} from '@auto-drive/models'
import {
  ObjectUseCases,
  OwnershipUseCases,
  SubscriptionsUseCases,
} from '../index.js'
import { uploadsRepository } from '../../repositories/uploads/uploads.js'
import { BlockstoreUseCases } from '../uploads/blockstore.js'
import { asyncIterableToPromiseOfArray } from '@autonomys/asynchronous'
import { downloadService } from '../../services/download/index.js'
import { FileGateway } from '../../services/dsn/fileGateway/index.js'
import { Readable } from 'stream'
import { createLogger } from '../../../drivers/logger.js'
import { ByteRange } from '@autonomys/file-caching'
import { sliceReadable } from '../../../utils/readable.js'
import { DBObjectFetcher, FileGatewayObjectFetcher } from './fetchers.js'
import { composeNodesDataAsFileReadable } from './nodeComposer.js'

const logger = createLogger('useCases:objects:files')

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

const handleFileUploadFinalization = async (
  user: UserWithOrganization,
  uploadId: string,
): Promise<string> => {
  logger.debug(
    'handleFileUploadFinalization called (uploadId=%s, userId=%s)',
    uploadId,
    user.oauthUserId,
  )
  const pendingCredits =
    await SubscriptionsUseCases.getPendingCreditsByUserAndType(
      user,
      InteractionType.Upload,
    )
  const { metadata } = await generateFileArtifacts(uploadId)
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (pendingCredits < metadata.totalSize) {
    throw new Error('Not enough upload credits')
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

  await SubscriptionsUseCases.registerInteraction(
    user,
    InteractionType.Upload,
    metadata.totalSize.valueOf(),
  )

  logger.info(
    'handleFileUploadFinalization completed (cid=%s, userId=%s)',
    metadata.dataCid,
    user.oauthUserId,
  )
  return metadata.dataCid
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
  const { metadata, childrenArtifacts } =
    await generateFolderArtifacts(uploadId)

  const fullMetadata = [metadata, ...childrenArtifacts.map((e) => e.metadata)]
  await Promise.all(
    fullMetadata.map((childMetadata) =>
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

const getNodesForPartialRetrieval = async (
  chunks: ChunkInfo[],
  byteRange: ByteRange,
): Promise<{
  nodes: string[]
  firstNodeFileOffset: number
}> => {
  let accumulatedLength = 0
  const nodeRange: [number | null, number | null] = [null, null]
  let firstNodeFileOffset: number | undefined
  let i = 0

  logger.info('getNodesForPartialRetrieval called (byteRange=%s)', byteRange)

  // Searchs for the first node that contains the byte range
  while (nodeRange[0] === null && i < chunks.length) {
    const chunk = chunks[i]
    const chunkSize = Number(chunk.size.valueOf())
    // [accumulatedLength, accumulatedLength + chunkSize) // is the range of the chunk
    if (
      byteRange[0] >= accumulatedLength &&
      byteRange[0] < accumulatedLength + chunkSize
    ) {
      nodeRange[0] = i
      firstNodeFileOffset = accumulatedLength
    } else {
      accumulatedLength += chunkSize
      i++
    }
  }

  // Searchs for the last node that contains the byte range
  // unless the byte range is the last byte of the file
  if (byteRange[1]) {
    while (nodeRange[1] === null && i < chunks.length) {
      const chunk = chunks[i]
      const chunkSize = Number(chunk.size.valueOf())
      if (
        byteRange[1] >= accumulatedLength &&
        byteRange[1] < accumulatedLength + chunkSize
      ) {
        nodeRange[1] = i
      }
      accumulatedLength += chunkSize
      i++
    }
  }

  if (nodeRange[0] == null) {
    throw new Error('Byte range not found')
  }

  const nodes = chunks
    .slice(nodeRange[0], nodeRange[1] === null ? undefined : nodeRange[1] + 1)
    .map((e) => e.cid)

  return {
    nodes,
    firstNodeFileOffset: firstNodeFileOffset ?? 0,
  }
}

const retrieveFileByteRange = async (
  metadata: OffchainMetadata,
  byteRange: ByteRange,
): Promise<Readable> => {
  if (metadata.type === 'folder') {
    throw new Error('Partial retrieval is not supported in folders')
  }

  const { nodes, firstNodeFileOffset } = await getNodesForPartialRetrieval(
    metadata.chunks,
    byteRange,
  )

  const isArchived = await ObjectUseCases.isArchived(metadata.dataCid)
  const fetcher = isArchived ? FileGatewayObjectFetcher : DBObjectFetcher

  const reader = await composeNodesDataAsFileReadable({
    fetcher,
    chunks: nodes,
    concurrentChunks: 100,
  })

  const offsetWithinFirstNode = byteRange[0] - firstNodeFileOffset
  const upperBound = byteRange[1] ?? Number(metadata.totalSize)
  const length = upperBound - byteRange[0] + 1

  logger.info(
    'retrieveFileByteRange called (cid=%s, byteRange=%s, offsetWithinFirstNode=%s, length=%s)',
    metadata.dataCid,
    byteRange,
    offsetWithinFirstNode,
    length,
  )
  return sliceReadable(reader, offsetWithinFirstNode, length)
}

const retrieveFullFile = async (metadata: OffchainMetadata) => {
  logger.debug(
    'retrieveObject called (cid=%s, type=%s)',
    metadata.dataCid,
    metadata.type,
  )
  const isArchived = await ObjectUseCases.isArchived(metadata.dataCid)

  const fetcher = isArchived ? FileGatewayObjectFetcher : DBObjectFetcher

  return fetcher.fetchFile(metadata.dataCid)
}

const retrieveObject = async (
  metadata: OffchainMetadata,
  options?: DownloadServiceOptions,
): Promise<Readable> => {
  const byteRange = options?.byteRange

  const isFullRetrieval = !byteRange
  if (isFullRetrieval) {
    return retrieveFullFile(metadata)
  }

  return retrieveFileByteRange(metadata, byteRange)
}

export const FilesUseCases = {
  handleFileUploadFinalization,
  handleFolderUploadFinalization,
  getNodesForPartialRetrieval,
  retrieveObject,
}
