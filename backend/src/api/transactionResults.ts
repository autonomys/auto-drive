import { cidToString } from "@autonomys/auto-drive";
import { CID } from "multiformats";
import { TransactionResult } from "../services/transactionManager";
import { transactionResultsRepository } from "../repositories/transactionResults.js";

export const getNodeTransactionResult = async (cid: CID | string) => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);

  return transactionResultsRepository
    .getTransactionResult(cidString)
    .then((result) => (result ? result.transaction_result : undefined));
};

export const getHeadTransactionResults = async (cid: CID | string) => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);

  return transactionResultsRepository.getHeadTransactionResults(cidString);
};

export const setTransactionResults = async (
  head_cid: CID | string,
  cid: CID | string,
  transactionResults: TransactionResult
) => {
  console.log("setTransactionResults", head_cid, cid, transactionResults);

  let cidString = typeof cid === "string" ? cid : cidToString(cid);
  let headCidString =
    typeof head_cid === "string" ? head_cid : cidToString(head_cid);

  return transactionResultsRepository.storeTransactionResult(
    headCidString,
    cidString,
    transactionResults
  );
};

export const getPendingTransactionResults = async () => {
  return transactionResultsRepository.getPendingUploads();
};
