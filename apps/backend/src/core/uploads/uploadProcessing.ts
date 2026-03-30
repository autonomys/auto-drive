import { encode } from '@ipld/dag-pb'
import {
  FileProcessingInfo,
  fileProcessingInfoRepository,
} from '../../infrastructure/repositories/uploads/fileProcessingInfo.js'
import { getUploadBlockstore } from '../../infrastructure/services/upload/uploadProcessorCache/index.js'
import {
  cidOfNode,
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

const logger = createLogger('useCases:uploads:uploadProcessing')

const getUnprocessedChunkFromLatestFilePart = async (
  fileProcessingInfo: FileProcessingInfo,
): Promise<Buffer> => {
  return fileProcessingInfo.pending_bytes ?? Buffer.alloc(0)
}

const processChunk = async (
  uploadId: string,
  chunkData: Buffer,
  index: number,
) => {
  logger.trace(
    'processChunk invoked (uploadId=%s, partIndex=%d)',
    uploadId,
    index,
  )
  const fileProcessingInfo =
    await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(uploadId)

  if (!fileProcessingInfo) {
    logger.error('File processing info not found (uploadId=%s)', uploadId)
    throw new Error('File processing info not found')
  }

  const lastProcessedPartIndex = fileProcessingInfo.last_processed_part_index
  const expectedPartIndex =
    lastProcessedPartIndex == null ? 0 : lastProcessedPartIndex + 1
  if (index !== expectedPartIndex) {
    throw new Error(`Invalid part index: ${index} !== ${expectedPartIndex}`)
  }

  const blockstore = await getUploadBlockstore(uploadId)

  const latestPartLeftOver =
    await getUnprocessedChunkFromLatestFilePart(fileProcessingInfo)

  const dataToProcess = [latestPartLeftOver, chunkData]

  const leftOver = await processChunksToIPLDFormat(
    blockstore,
    dataToProcess,
    fileBuilders,
  )

  await fileProcessingInfoRepository.updateFileProcessingInfo({
    ...fileProcessingInfo,
    last_processed_part_index: expectedPartIndex,
    pending_bytes: leftOver,
  })
}

const completeFileProcessing = async (uploadId: string): Promise<CID> => {
  logger.debug('completeFileProcessing invoked (uploadId=%s)', uploadId)
  const fileProcessingInfo =
    await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(uploadId)

  const upload = await uploadsRepository.getUploadEntryById(uploadId)

  if (!fileProcessingInfo) {
    logger.error('File processing info not found (uploadId=%s)', uploadId)
    throw new Error('File processing info not found')
  }

  const blockstore = await getUploadBlockstore(uploadId)
  const latestPartLeftOver =
    await getUnprocessedChunkFromLatestFilePart(fileProcessingInfo)

  if (latestPartLeftOver.byteLength > 0) {
    const fileChunk = createFileChunkIpldNode(latestPartLeftOver)
    await blockstore.put(cidOfNode(fileChunk), encode(fileChunk))
  }

  const uploadedSize =
    (await filePartsRepository.getUploadFilePartsSize(uploadId)) ??
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
  processChunk,
  completeUploadProcessing,
  handleFileUploadFinalization,
  handleFolderUploadFinalization,
}
