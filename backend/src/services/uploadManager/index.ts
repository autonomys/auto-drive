import {
  getPendingTransactionResults,
  setTransactionResults,
} from "../../api/transactionResults.js";
import { createTransactionManager } from "../transactionManager/index.js";

let state = {
  started: false,
  time: 10_000,
};

const transactionManager = createTransactionManager(
  process.env.RPC_ENDPOINT || "ws://localhost:9944"
);

const processPendingUploads = async () => {
  const pendingUploads = await getPendingTransactionResults();

  console.log(`${pendingUploads.length} pending uploads`);
  if (pendingUploads.length === 0) {
    return;
  }

  const transactions = pendingUploads.map((upload) => {
    return {
      module: "system",
      method: "remark",
      params: [upload.encoded_node],
    };
  });

  const results = await transactionManager.submit(transactions);

  await Promise.all(
    pendingUploads.map((upload, index) => {
      setTransactionResults(upload.head_cid, upload.cid, results[index]);
    })
  );
};

export const uploadManager = {
  start: (time: number = 10_000) => {
    state.time = time;
    state.started = true;
    setTimeout(processPendingUploads, state.time);
  },
};
