import { UploadStatus } from "../models/object";
import { transactionResultsRepository } from "../repositories";

const getUploadStatus = async (cid: string): Promise<UploadStatus> => {
  const totalNodes =
    await transactionResultsRepository.getHeadTransactionResults(cid);
  const toBeUploadedNodes =
    await transactionResultsRepository.getPendingUploadsByHeadCid(cid);

  return {
    uploadedNodes: totalNodes.length - toBeUploadedNodes.length,
    totalNodes: totalNodes.length,
    minimumBlockDepth: 0,
  };
};

export const UploadStatusUseCases = {
  getUploadStatus,
};
