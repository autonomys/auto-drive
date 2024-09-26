import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";

export let db: Database;

const initSchema = async (db: Database) => {
  /// Metadata
  await db.exec(
    "CREATE TABLE IF NOT EXISTS metadata (cid TEXT PRIMARY KEY, metadata TEXT)"
  );

  // Nodes
  await db.exec(
    "CREATE TABLE IF NOT EXISTS nodes (cid TEXT PRIMARY KEY, head_cid TEXT, type TEXT, encoded_node TEXT)"
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS nodes_head_cid ON nodes (head_cid)"
  );

  // Transaction Results
  await db.run(
    "CREATE TABLE IF NOT EXISTS transactionResults (cid TEXT PRIMARY KEY, transaction_result TEXT, head_cid TEXT)"
  );
};

const createDB = async (
  filename: string = "./database.sqlite"
): Promise<Database> => {
  const db = await open({
    filename,
    driver: sqlite3.Database,
  });

  await initSchema(db);

  return db;
};

export const getDatabase = async () => {
  if (!db) {
    db = await createDB();
  }

  return db;
};
