import pg from 'pg'
import { config } from '../config'
import { env } from '../utils/misc'

let db: pg.Client | undefined

export const createPgDB = async (
  dbConfig: string | pg.ClientConfig = config.postgres.url,
): Promise<pg.Client> => {
  const client = new pg.Client(dbConfig)

  await client.connect()

  return client
}

export const createRDSConnection = async (): Promise<pg.Client> => {
  const client = new pg.Client({
    host: env('RDS_CLUSTER_ENDPOINT'),
    port: Number(env('RDS_CLUSTER_PORT', '5432')),
    user: env('RDS_CLUSTER_USER', 'admin'),
    password: env('RDS_CLUSTER_PASSWORD'),
    database: env('DB_NAME', 'postgres'),
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()

  return client
}

export const createDB = async () => {
  const isRDS = !!process.env.RDS_CLUSTER_ENDPOINT
  if (isRDS) {
    return createRDSConnection()
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
