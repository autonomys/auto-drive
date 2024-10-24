import { encode } from "@ipld/dag-pb";
import { filePartsRepository } from "../../repositories/uploads/fileParts.js";
import {
  FileProcessingInfo,
  fileProcessingInfoRepository,
} from "../../repositories/uploads/fileProcessingInfo.js";
import { getUploadBlockstore } from "../../services/uploadProcessorCache/index.js";
import {
  cidOfNode,
  createFileChunkIpldNode,
  DEFAULT_MAX_CHUNK_SIZE,
  fileBuilders,
  MetadataType,
  processBufferToIPLDFormatFromChunks,
  processChunksToIPLDFormat,
} from "@autonomys/auto-drive";
import { FolderUpload, UploadType } from "../../models/uploads/upload.js";
import { BlockstoreUseCases } from "./blockstore.js";
import { mapTableToModel } from "./uploads.js";
import {
  UploadEntry,
  uploadsRepository,
} from "../../repositories/uploads/uploads.js";

const getUnprocessedChunkFromLatestFilePart = async (
  fileProcessingInfo: FileProcessingInfo
): Promise<Buffer> => {
  if (
    !fileProcessingInfo.last_processed_part_index ||
    !fileProcessingInfo.last_processed_part_offset
  ) {
    return Buffer.alloc(0);
  }

  const filePart = await filePartsRepository.getChunkByUploadIdAndPartIndex(
    fileProcessingInfo.upload_id,
    fileProcessingInfo.last_processed_part_index
  );

  if (!filePart) {
    throw new Error("File part not found");
  }

  return filePart.data.subarray(fileProcessingInfo.last_processed_part_offset);
};

const processChunk = async (
  uploadId: string,
  chunkData: Buffer,
  index: number
) => {
  console.log(`Processing chunk ${index} of ${uploadId}`);
  const fileProcessingInfo =
    await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(
      uploadId
    );

  if (!fileProcessingInfo) {
    throw new Error("File processing info not found");
  }

  const lastProcessedPartIndex = fileProcessingInfo.last_processed_part_index;
  const expectedPartIndex =
    lastProcessedPartIndex == null ? 0 : lastProcessedPartIndex + 1;
  if (index !== expectedPartIndex) {
    throw new Error(`Invalid part index: ${index} !== ${expectedPartIndex}`);
  }

  const blockstore = await getUploadBlockstore(uploadId);

  const latestPartLeftOver = await getUnprocessedChunkFromLatestFilePart(
    fileProcessingInfo
  );

  const bufferToProcess = Buffer.concat([latestPartLeftOver, chunkData]);

  const leftOver = await processChunksToIPLDFormat(
    blockstore,
    [bufferToProcess],
    fileBuilders,
    { maxChunkSize: DEFAULT_MAX_CHUNK_SIZE }
  );

  const filePartOffset = chunkData.byteLength - leftOver.byteLength;

  await fileProcessingInfoRepository.updateFileProcessingInfo({
    ...fileProcessingInfo,
    last_processed_part_index: expectedPartIndex,
    last_processed_part_offset: filePartOffset,
  });
};

const completeFileProcessing = async (uploadId: string): Promise<void> => {
  const fileProcessingInfo =
    await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(
      uploadId
    );

  const upload = await uploadsRepository.getUploadEntryById(uploadId);

  if (!fileProcessingInfo) {
    throw new Error("File processing info not found");
  }

  const blockstore = await getUploadBlockstore(uploadId);
  const latestPartLeftOver = await getUnprocessedChunkFromLatestFilePart(
    fileProcessingInfo
  );

  if (latestPartLeftOver.byteLength > 0) {
    const fileChunk = createFileChunkIpldNode(latestPartLeftOver);
    await blockstore.put(cidOfNode(fileChunk), encode(fileChunk));
  }

  await processBufferToIPLDFormatFromChunks(
    blockstore,
    blockstore.getFilteredMany(MetadataType.FileChunk),
    upload?.name,
    fileBuilders
  );
};

const completeUploadProcessing = async (upload: UploadEntry): Promise<void> => {
  if (upload.type === UploadType.FILE) {
    await completeFileProcessing(upload.id);
  } else if (upload.type === UploadType.FOLDER) {
    await BlockstoreUseCases.processFolderUpload(
      mapTableToModel(upload) as FolderUpload
    );
  }
};

export const FileProcessingUseCase = {
  processChunk,
  completeUploadProcessing,
};
