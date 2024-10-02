import pg from "pg";

export let db: pg.Client;

const createDB = async (): Promise<pg.Client> => {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  return client;
};

export const getDatabase = async () => {
  if (!db) {
    db = await createDB();
  }

  return db;
};
