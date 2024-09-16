import { ApiPromise } from "@polkadot/api";
import { TransactionResult } from "./types.js";

export const retrieveRemarkFromTransaction = async (
  api: ApiPromise,
  result: TransactionResult
): Promise<string | null> => {
  if (!result.success || !result.blockHash || result.index === undefined) {
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

    if (batchExtrinsic.method.method !== "batchAll") {
      console.error("Extrinsic is not a batch");
      return null;
    }

    const batchCalls = batchExtrinsic.method.args[0] as unknown as any[];

    if (result.index >= batchCalls.length) {
      console.error("Invalid extrinsic index within batch");
      return null;
    }

    const targetCall = batchCalls[result.index];

    if (
      (targetCall.method === "remarkWithEvent" ||
        targetCall.method === "remark") &&
      targetCall.section === "system"
    ) {
      const remarkHex = targetCall.args[0].toHex();
      return Buffer.from(remarkHex.slice(2), "hex").toString("utf8");
    } else {
      console.error("Target call is not a remark");
      return null;
    }
  } catch (error) {
    console.error("Error retrieving remark:", error);
    return null;
  }
};
