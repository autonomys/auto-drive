import pg from 'pg'
import { config } from '../config.js'
import { DsqlSigner } from '@aws-sdk/dsql-signer'
import { env } from '../utils/misc.js'
import { createLogger } from './logger.js'

let db: pg.Client | undefined

const logger = createLogger('auth:pg')

export const createPgDB = async (
  dbConfig: string | pg.ClientConfig = config.postgres.url,
): Promise<pg.Client> => {
  const client = new pg.Client(dbConfig)

  await client.connect()

  logger.info('Connected to PostgreSQL')

  const originalPgQuery = client.query.bind(client)
  client.query = ((...args: Parameters<typeof client.query>) => {
    logger.trace(
      'SQL Query: %s',
      typeof args[0] === 'string' ? args[0] : '<prepared>',
    )
    return originalPgQuery(...args)
  }) as typeof client.query

  return client
}

export const createDSQLConnection = async (): Promise<pg.Client> => {
  const signer = new DsqlSigner({
    hostname: env('DSQL_CLUSTER_ENDPOINT'),
    region: env('AWS_REGION'),
  })

  const token = await signer.getDbConnectAdminAuthToken()

  const client = new pg.Client({
    host: env('DSQL_CLUSTER_ENDPOINT'),
    port: Number(env('DSQL_CLUSTER_PORT', '5432')),
    user: env('DSQL_CLUSTER_USER', 'admin'),
    password: token,
    database: env('DB_NAME', 'postgres'),
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()

  logger.info('Connected to DSQL cluster')

  const originalDsqlQuery = client.query.bind(client)
  client.query = ((...args: Parameters<typeof client.query>) => {
    logger.trace(
      'SQL (DSQL) Query: %s',
      typeof args[0] === 'string' ? args[0] : '<prepared>',
    )
    return originalDsqlQuery(...args)
  }) as typeof client.query

  return client
}

export const createDB = async () => {
  const isDSQL = !!process.env.DSQL_CLUSTER_ENDPOINT
  if (isDSQL) {
    return createDSQLConnection()
  }

  return createPgDB()
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
