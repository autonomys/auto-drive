import { cidToString } from "@autonomys/auto-drive";
import { CID } from "multiformats";
import { TransactionResult } from "../services/transactionManager";
import { transactionResultsRepository } from "../repositories/transactionResults.js";

export const getTransactionResults = async (cid: CID | string) => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);

  return transactionResultsRepository
    .getTransactionResult(cidString)
    .then((result) => (result ? result.transaction_results : undefined));
};

export const setTransactionResults = async (
  cid: CID | string,
  transactionResults: TransactionResult[]
) => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);

  return transactionResultsRepository.storeTransactionResult(
    cidString,
    transactionResults
  );
};
