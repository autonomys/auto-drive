import { cidToString } from "@autonomys/auto-drive";
import { CID } from "multiformats";
import { transactionResultsRepository } from "../repositories/transactionResults.js";
import { TransactionResult } from "../services/transactionManager";

const getNodeTransactionResult = async (cid: CID | string) => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);

  return transactionResultsRepository
    .getTransactionResult(cidString)
    .then((result) => (result ? result.transaction_result : undefined));
};

const getHeadTransactionResults = async (cid: CID | string) => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);

  return transactionResultsRepository.getHeadTransactionResults(cidString);
};

const setTransactionResults = async (
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

const getPendingTransactionResults = async () => {
  return transactionResultsRepository.getPendingUploads();
};

export const TransactionResultsUseCases = {
  getNodeTransactionResult,
  getHeadTransactionResults,
  setTransactionResults,
  getPendingTransactionResults,
};
