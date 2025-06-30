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

  const origQuery = client.query.bind(client)
  client.query = ((text: unknown, params?: unknown) => {
    logger.trace('SQL Query: %s', typeof text === 'string' ? text : '<prepared>')
    return origQuery(text as any, params as any)
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

  const origQuery2 = client.query.bind(client)
  client.query = ((text: unknown, params?: unknown) => {
    logger.trace('SQL (DSQL) Query: %s', typeof text === 'string' ? text : '<prepared>')
    return origQuery2(text as any, params as any)
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
