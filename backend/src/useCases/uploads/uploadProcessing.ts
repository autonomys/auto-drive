import { encode } from '@ipld/dag-pb'
import {
  FileProcessingInfo,
  fileProcessingInfoRepository,
} from '../../repositories/uploads/fileProcessingInfo.js'
import { getUploadBlockstore } from '../../services/upload/uploadProcessorCache/index.js'
import {
  cidOfNode,
  createFileChunkIpldNode,
  DEFAULT_MAX_CHUNK_SIZE,
  DEFAULT_MAX_LINK_PER_NODE,
  fileBuilders,
  MetadataType,
  processBufferToIPLDFormatFromChunks,
  processChunksToIPLDFormat,
} from '@autonomys/auto-dag-data'
import { FolderUpload, UploadType } from '../../models/uploads/upload.js'
import { BlockstoreUseCases } from './blockstore.js'
import { mapTableToModel } from './uploads.js'
import {
  UploadEntry,
  uploadsRepository,
} from '../../repositories/uploads/uploads.js'
import { filePartsRepository } from '../../repositories/uploads/fileParts.js'
import { CID } from 'multiformats'

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
  const fileProcessingInfo =
    await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(uploadId)

  if (!fileProcessingInfo) {
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
  const fileProcessingInfo =
    await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(uploadId)

  const upload = await uploadsRepository.getUploadEntryById(uploadId)

  if (!fileProcessingInfo) {
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

  return processBufferToIPLDFormatFromChunks(
    blockstore,
    blockstore.getFilteredMany(MetadataType.FileChunk),
    upload?.name,
    uploadedSize,
    fileBuilders,
    uploadOptions,
  )
}

const completeUploadProcessing = async (upload: UploadEntry): Promise<CID> => {
  if (upload.type === UploadType.FILE) {
    return completeFileProcessing(upload.id)
  } else if (upload.type === UploadType.FOLDER) {
    return BlockstoreUseCases.processFolderUpload(
      mapTableToModel(upload) as FolderUpload,
    )
  } else {
    throw new Error('Invalid upload type')
  }
}

export const FileProcessingUseCase = {
  processChunk,
  completeUploadProcessing,
}
