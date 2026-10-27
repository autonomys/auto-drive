import pg from 'pg'
import { config } from '../../config.js'
import { createLogger } from './logger.js'

// Cache the pending promise, not the resolved pool: concurrent first callers
// must share one pool instead of each creating their own.
let db: Promise<pg.Pool> | undefined

const logger = createLogger('drivers:pg')

// Short host/database label for the connection log line
const describeTarget = (url: string) => {
  try {
    const { hostname, port, pathname } = new URL(url)
    return `${hostname}:${port}${pathname}`
  } catch {
    return '<unparseable DATABASE_URL>'
  }
}

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

  logger.info(
    'Connected to PostgreSQL at %s',
    describeTarget(config.postgres.url),
  )

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
    db = createDB().catch((error) => {
      db = undefined
      throw error
    })
  }

  return db
}

export const closeDatabase = async () => {
  if (db) {
    const pending = db
    db = undefined
    // A pool that never connected has nothing to end
    const pool = await pending.catch(() => undefined)
    await pool?.end()
  }
}

process.on('beforeExit', closeDatabase)
