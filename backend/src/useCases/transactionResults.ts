import { cidToString } from "@autonomys/auto-drive";
import { ApiPromise } from "@polkadot/api";
import { CID } from "multiformats";
import { createConnection } from "../drivers/index.js";
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

const retrieveRemarkFromTransaction = async (
  result: TransactionResult
): Promise<string | null> => {
  if (!result.success || !result.blockHash) {
    console.error("Invalid transaction result");
    return null;
  }

  try {
    const api = await createConnection();
    const block = await api.rpc.chain.getBlock(result.blockHash);
    const extrinsics = block.block.extrinsics;

    const extrinsic = extrinsics.find(
      (ex) => ex.hash.toHex() === result.batchTxHash
    );

    if (!extrinsic) {
      console.error("Batch extrinsic not found");
      return null;
    }

    if (["remarkWithEvent", "remark"].includes(extrinsic.method.method)) {
      console.error("Extrinsic is not a batch");
      return null;
    }

    const bytes = extrinsic.method.args[0];

    return Buffer.from(bytes.toHex(), "hex").toString("utf8");
  } catch (error) {
    console.error("Error retrieving remark:", error);
    return null;
  }
};

const getPendingTransactionResults = async () => {
  return transactionResultsRepository.getPendingUploads();
};

export const TransactionResultsUseCases = {
  getNodeTransactionResult,
  getHeadTransactionResults,
  setTransactionResults,
  getPendingTransactionResults,
  retrieveRemarkFromTransaction,
};
