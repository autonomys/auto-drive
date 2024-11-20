import pg from 'pg'

let db: pg.Client | undefined

const createDB = async (): Promise<pg.Client> => {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  })

  await client.connect()

  return client
}

export const getDatabase = async () => {
  if (!db) {
    db = await createDB()
  }

  return db
}

export const closeDatabase = async () => {
  if (db) {
    await db.end()
    db = undefined
  }
}
