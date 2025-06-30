import pg from 'pg'
import { config } from '../config.js'
import { createLogger } from './logger.js'

let db: pg.Pool | undefined

const logger = createLogger('drivers:pg')

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

  logger.info('Connected to PostgreSQL at %s', config.postgres.url)

  // DEBUG: wrap query for tracing
  const origQuery = pool.query.bind(pool)
  pool.query = ((text: unknown, params?: unknown) => {
    logger.trace('SQL Query: %s', typeof text === 'string' ? text : '<prepared>')
    return origQuery(text as any, params as any)
  }) as typeof pool.query

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
