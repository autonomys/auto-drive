import { TransactionResult } from "../services/transactionManager";
import { getDatabase } from "./sqlite.js";

export interface TransactionResultEntry<
  T extends TransactionResult[] | string = string
> {
  cid: string;
  transaction_results: T;
}

const initTable = async () => {
  const db = await getDatabase();

  await db.run(
    "CREATE TABLE IF NOT EXISTS transactionResults (cid TEXT PRIMARY KEY, transaction_results TEXT)"
  );

  return db;
};

const saveTransactionResult = async (
  cid: string,
  transaction_results: TransactionResult[]
) => {
  const db = await initTable();

  await db.run(
    "INSERT OR REPLACE INTO transactionResults (cid, transaction_results) VALUES (?, ?)",
    cid,
    JSON.stringify(transaction_results)
  );
};

const getTransactionResult = async (cid: string) => {
  const db = await initTable();

  const result = await db
    .get<TransactionResultEntry>(
      "SELECT * FROM transactionResults WHERE cid = ?",
      cid
    )
    .then((row) => {
      return row
        ? ({
            ...row,
            transaction_results: JSON.parse(row.transaction_results),
          } as TransactionResultEntry<TransactionResult[]>)
        : undefined;
    });

  return result;
};

export const transactionResultsRepository = {
  storeTransactionResult: saveTransactionResult,
  getTransactionResult,
};
