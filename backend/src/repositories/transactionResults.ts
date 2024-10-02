import { getDatabase } from "../drivers/pg.js";
import { TransactionResult } from "../services/transactionManager";
import { Node } from "./nodes.js";

export interface TransactionResultEntry {
  head_cid: string;
  cid: string;
  transaction_result: TransactionResult;
}

const storeTransactionResult = async (
  head_cid: string,
  cid: string,
  transaction_result: TransactionResult
) => {
  const db = await getDatabase();

  await db.query({
    text: "INSERT INTO transaction_results (cid, transaction_result, head_cid) VALUES ($1, $2, $3) ON CONFLICT (cid) DO UPDATE SET transaction_result = EXCLUDED.transaction_result, head_cid = EXCLUDED.head_cid",
    values: [cid, JSON.stringify(transaction_result), head_cid],
  });
};

const getTransactionResult = async (cid: string) => {
  const db = await getDatabase();

  const result = await db
    .query<TransactionResultEntry>({
      text: "SELECT * FROM transaction_results WHERE cid = $1",
      values: [cid],
    })
    .then(({ rows }) => {
      return rows.length > 0 ? rows[0] : undefined;
    });

  return result;
};

const getHeadTransactionResults = async (head_cid: string) => {
  const db = await getDatabase();
  const result = await db
    .query<TransactionResultEntry>({
      text: "SELECT * FROM transaction_results WHERE head_cid = $1",
      values: [head_cid],
    })
    .then(({ rows }) => rows);

  return result;
};

const getPendingUploads = async (limit: number = 100) => {
  const db = await getDatabase();
  const result = await db
    .query<Node>(
      `
    SELECT n.* FROM nodes n left join transaction_results tr on n.cid = tr.cid where tr.cid is null limit $1
  `,
      [limit]
    )
    .then(({ rows }) => rows);

  return result;
};

const getPendingUploadsByHeadCid = async (head_cid: string) => {
  const db = await getDatabase();
  const result = await db
    .query<Node>({
      text: `
    SELECT n.* FROM nodes n left join transaction_results tr on n.cid = tr.cid where tr.cid is null and n.head_cid = $1
  `,
      values: [head_cid],
    })
    .then(({ rows }) => rows);

  return result;
};

export const transactionResultsRepository = {
  storeTransactionResult,
  getTransactionResult,
  getPendingUploads,
  getHeadTransactionResults,
  getPendingUploadsByHeadCid,
};
