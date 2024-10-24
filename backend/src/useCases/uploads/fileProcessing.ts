import { filePartsRepository } from "../../repositories/uploads/fileParts.js";
import {
  FileProcessingInfo,
  fileProcessingInfoRepository,
} from "../../repositories/uploads/fileProcessingInfo.js";
import { getUploadBlockstore } from "../../services/uploadProcessorCache/index.js";
import {
  DEFAULT_MAX_CHUNK_SIZE,
  fileBuilders,
  processChunksToIPLDFormat,
} from "@autonomys/auto-drive";

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

export const FileProcessingUseCase = {
  processChunk,
};
