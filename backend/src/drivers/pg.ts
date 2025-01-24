import pg from 'pg'
import { config } from '../config.js'

let db: pg.Client | undefined

const createDB = async (): Promise<pg.Client> => {
  const client = new pg.Client({
    connectionString: config.postgres.url,
    ...(process.env.ACCEPT_UNAUTHORIZED_CERTS === 'true'
      ? {
          ssl: {
            rejectUnauthorized: false,
          },
        }
      : {}),
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
