import { UploadStatus } from "../models/index.js";
import { transactionResultsRepository } from "../repositories/index.js";

const getUploadStatus = async (cid: string): Promise<UploadStatus> => {
  const totalNodes =
    await transactionResultsRepository.getHeadTransactionResults(cid);
  const uploadedNodes = await transactionResultsRepository.getUploadedNodes(
    cid
  );
  const minimumBlockDepth = uploadedNodes
    .filter((e) => e.transaction_result.blockNumber)
    .map((e) => e.transaction_result.blockNumber!)
    .reduce((a, b) => (a === null ? b : Math.min(a, b)), null as number | null);

  const maxSeenBlockDepth = uploadedNodes
    .filter((e) => e.transaction_result.blockNumber)
    .map((e) => e.transaction_result.blockNumber!)
    .reduce((a, b) => (a === null ? b : Math.max(a, b)), null as number | null);

  const isFullyUploaded = uploadedNodes.length === totalNodes.length;

  const maximumBlockDepth = isFullyUploaded ? maxSeenBlockDepth : null;

  return {
    uploadedNodes: uploadedNodes.length,
    totalNodes: totalNodes.length,
    minimumBlockDepth,
    maximumBlockDepth,
  };
};

export const UploadStatusUseCases = {
  getUploadStatus,
};
