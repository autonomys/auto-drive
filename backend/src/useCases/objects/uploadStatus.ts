import { UploadStatus } from "../../models/objects/index.js";
import { UploadStatus as UploadStatusType } from "../../models/uploads/upload.js";
import {
  nodesRepository,
  transactionResultsRepository,
} from "../../repositories/index.js";
import { uploadsRepository } from "../../repositories/uploads/uploads.js";

const getUploadStatus = async (cid: string): Promise<UploadStatus> => {
  const uploadStatus = await uploadsRepository.getStatusByCID(cid);
  const isMigratingOrPending =
    uploadStatus &&
    [UploadStatusType.MIGRATING, UploadStatusType.PENDING].includes(
      uploadStatus
    );

  if (isMigratingOrPending) {
    return {
      uploadedNodes: null,
      totalNodes: null,
      minimumBlockDepth: null,
      maximumBlockDepth: null,
    };
  }

  const totalNodes = await nodesRepository.getNodeCount({ rootCid: cid });
  const uploadedNodes =
    await transactionResultsRepository.getUploadedNodesByRootCid(cid);

  const minimumBlockDepth = uploadedNodes
    .filter((e) => e.transaction_result.blockNumber)
    .map((e) => e.transaction_result.blockNumber!)
    .reduce((a, b) => (a === null ? b : Math.min(a, b)), null as number | null);

  const maxSeenBlockDepth = uploadedNodes
    .filter((e) => e.transaction_result.blockNumber)
    .map((e) => e.transaction_result.blockNumber!)
    .reduce((a, b) => (a === null ? b : Math.max(a, b)), null as number | null);

  const isFullyUploaded = uploadedNodes.length === totalNodes;

  const maximumBlockDepth = isFullyUploaded ? maxSeenBlockDepth : null;

  return {
    uploadedNodes: uploadedNodes.length,
    totalNodes: null,
    minimumBlockDepth,
    maximumBlockDepth,
  };
};

export const UploadStatusUseCases = {
  getUploadStatus,
};
