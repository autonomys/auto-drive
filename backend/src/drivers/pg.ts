import pg from 'pg'
import { config } from '../config'

let db: pg.Client | undefined

const createDB = async (): Promise<pg.Client> => {
  const client = new pg.Client({
    connectionString: config.postgres.url,
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
