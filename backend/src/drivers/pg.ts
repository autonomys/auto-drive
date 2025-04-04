import pg from 'pg'
import { config } from '../config.js'

let db: pg.Pool | undefined

const createDB = async (): Promise<pg.Pool> => {
  const pool = new pg.Pool({
    connectionString: config.postgres.url,
    ...(process.env.ACCEPT_UNAUTHORIZED_CERTS === 'true'
      ? {
          ssl: {
            rejectUnauthorized: false,
          },
        }
      : {}),
  })

  await pool.connect()

  return pool
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
