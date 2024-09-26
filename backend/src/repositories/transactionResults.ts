import { getDatabase } from "../drivers/sqlite.js";
import { TransactionResult } from "../services/transactionManager";
import { Node } from "./nodes.js";

export interface TransactionResultEntry<
  T extends TransactionResult | string = string
> {
  head_cid: string;
  cid: string;
  transaction_result: T;
}

const storeTransactionResult = async (
  head_cid: string,
  cid: string,
  transaction_result: TransactionResult
) => {
  const db = await getDatabase();

  await db.run(
    "INSERT OR REPLACE INTO transactionResults (cid, transaction_result, head_cid) VALUES (?, ?, ?)",
    cid,
    JSON.stringify(transaction_result),
    head_cid
  );
};

const getTransactionResult = async (cid: string) => {
  const db = await getDatabase();

  const result = await db
    .get<TransactionResultEntry>(
      "SELECT * FROM transactionResults WHERE cid = ?",
      cid
    )
    .then((row) => {
      return row
        ? ({
            ...row,
            transaction_result: JSON.parse(row.transaction_result),
          } as TransactionResultEntry<TransactionResult>)
        : undefined;
    });

  return result;
};

const getHeadTransactionResults = async (head_cid: string) => {
  const db = await getDatabase();
  const result = await db.all(
    `
    SELECT * FROM transactionResults WHERE head_cid = ?`,
    head_cid
  );

  return result;
};

const getPendingUploads = async (limit: number = 100) => {
  const db = await getDatabase();
  const result = await db.all<Node[]>(
    `
    SELECT n.* FROM nodes n left join transactionResults tr on n.cid = tr.cid where tr.cid is null limit ?
  `,
    limit
  );

  return result;
};

const getPendingUploadsByHeadCid = async (head_cid: string) => {
  const db = await getDatabase();
  const result = await db.all<Node[]>(
    `
    SELECT n.* FROM nodes n left join transactionResults tr on n.cid = tr.cid where tr.cid is null and n.head_cid = ?
  `,
    head_cid
  );

  return result;
};

export const transactionResultsRepository = {
  storeTransactionResult,
  getTransactionResult,
  getPendingUploads,
  getHeadTransactionResults,
  getPendingUploadsByHeadCid,
};
