import pg from 'pg'
import { config } from '../../config.js'
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

  // Verify the connection works, then release the client back to the pool
  const client = await pool.connect()
  client.release()

  logger.info('Connected to PostgreSQL at %s', config.postgres.url)

  // DEBUG: wrap query for tracing
  const origQuery = pool.query.bind(pool)
  pool.query = ((...args: Parameters<typeof pool.query>) => {
    logger.trace(
      'SQL Query: %s',
      typeof args[0] === 'string' ? args[0] : '<prepared>',
    )
    return origQuery(...args)
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

process.on('beforeExit', closeDatabase)
