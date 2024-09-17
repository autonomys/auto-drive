import { ApiPromise } from "@polkadot/api";
import { TransactionResult } from "./types.js";

export const retrieveRemarkFromTransaction = async (
  api: ApiPromise,
  result: TransactionResult
): Promise<string | null> => {
  if (!result.success || !result.blockHash) {
    console.error("Invalid transaction result");
    return null;
  }

  try {
    const block = await api.rpc.chain.getBlock(result.blockHash);
    const extrinsics = block.block.extrinsics;

    const batchExtrinsic = extrinsics.find(
      (ex) => ex.hash.toHex() === result.batchTxHash
    );

    if (!batchExtrinsic) {
      console.error("Batch extrinsic not found");
      return null;
    }

    if (batchExtrinsic.method.method !== "remarkWithEvent") {
      console.error("Extrinsic is not a batch");
      return null;
    }

    const bytes = batchExtrinsic.method.args[0];

    return Buffer.from(bytes.toHex(), "hex").toString("utf8");
  } catch (error) {
    console.error("Error retrieving remark:", error);
    return null;
  }
};
