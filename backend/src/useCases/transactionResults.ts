import { cidToString } from "@autonomys/auto-drive";
import { CID } from "multiformats";
import { transactionResultsRepository } from "../repositories/index.js";
import { TransactionResult } from "../services/transactionManager/index.js";

const getNodeTransactionResult = async (cid: CID | string) => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);

  return transactionResultsRepository
    .getTransactionResult(cidString)
    .then((result) => (result ? result.transaction_result : undefined));
};

const getHeadTransactionResults = async (cid: CID | string) => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);

  return transactionResultsRepository
    .getHeadTransactionResults(cidString)
    .then((rows) => rows.map((_) => _.transaction_result));
};

const setTransactionResults = async (
  cid: CID | string,
  transactionResults: TransactionResult
) => {
  console.log("setTransactionResults", cid, transactionResults);

  let cidString = typeof cid === "string" ? cid : cidToString(cid);

  return transactionResultsRepository.storeTransactionResult(
    cidString,
    transactionResults
  );
};

const getPendingTransactionResults = async (limit: number = 100) => {
  return transactionResultsRepository.getPendingUploads(limit);
};

export const TransactionResultsUseCases = {
  getNodeTransactionResult,
  getHeadTransactionResults,
  setTransactionResults,
  getPendingTransactionResults,
};
