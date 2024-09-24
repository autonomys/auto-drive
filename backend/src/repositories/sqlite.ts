import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";

export let db: Database;

const createDB = async (
  filename: string = "./database.sqlite",
): Promise<Database> => {
  const db = await open({
    filename,
    driver: sqlite3.Database,
  });

  return db;
};

export const getDatabase = async () => {
  if (!db) {
    db = await createDB();
  }

  return db;
};
