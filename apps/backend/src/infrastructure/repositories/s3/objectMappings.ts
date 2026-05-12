import { getDatabase } from '../../drivers/pg.js'

export interface S3KeyMapping {
  bucket: string
  key: string
  cid: string
  createdAt: Date
  updatedAt: Date
}

export interface S3BucketInfo {
  name: string
  creationDate: Date
}

interface S3KeyMappingDB {
  bucket: S3KeyMapping['bucket']
  key: S3KeyMapping['key']
  cid: S3KeyMapping['cid']
  created_at: S3KeyMapping['createdAt']
  updated_at: S3KeyMapping['updatedAt']
}

interface S3BucketInfoDB {
  bucket: string
  created_at: Date
}

const mapDBToDomain = (db: S3KeyMappingDB): S3KeyMapping => ({
  bucket: db.bucket,
  key: db.key,
  cid: db.cid,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
})

const createMapping = async (
  bucket: string,
  s3Key: string,
  cid: string,
): Promise<S3KeyMapping> => {
  const db = await getDatabase()

  const result = await db.query<S3KeyMappingDB>({
    text: `
      INSERT INTO "S3".object_mappings
      (bucket, "key", cid)
      VALUES ($1, $2, $3)
      ON CONFLICT (bucket, "key") DO UPDATE SET cid = $3, updated_at = NOW()
      RETURNING *
    `,
    values: [bucket, s3Key, cid],
  })

  return result.rows.map(mapDBToDomain)[0]
}

const findByKey = async (
  bucket: string,
  s3Key: string,
): Promise<S3KeyMapping | null> => {
  const db = await getDatabase()

  const result = await db.query<S3KeyMappingDB>({
    text: `
      SELECT * FROM "S3".object_mappings
      WHERE bucket = $1 AND "key" = $2
    `,
    values: [bucket, s3Key],
  })

  if (result.rows.length === 0) {
    return null
  }

  return result.rows.map(mapDBToDomain)[0]
}

const updateMapping = async (
  bucket: string,
  s3Key: string,
  newCid: string,
): Promise<S3KeyMapping> => {
  const db = await getDatabase()

  const result = await db.query<S3KeyMappingDB>({
    text: `
      UPDATE "S3".object_mappings
      SET cid = $3, updated_at = NOW()
      WHERE bucket = $1 AND "key" = $2
      RETURNING *
    `,
    values: [bucket, s3Key, newCid],
  })

  if (result.rows.length === 0) {
    throw new Error(`S3 key mapping not found: ${bucket}/${s3Key}`)
  }

  return result.rows.map(mapDBToDomain)[0]
}

const findByCid = async (cid: string): Promise<S3KeyMapping[]> => {
  const db = await getDatabase()

  const result = await db.query<S3KeyMappingDB>({
    text: `
      SELECT * FROM "S3".object_mappings
      WHERE cid = $1
      ORDER BY bucket, "key"
    `,
    values: [cid],
  })

  return result.rows.map(mapDBToDomain)
}

const listBuckets = async (): Promise<S3BucketInfo[]> => {
  const db = await getDatabase()

  const result = await db.query<S3BucketInfoDB>({
    text: `
      SELECT bucket, MIN(created_at) AS created_at
      FROM "S3".object_mappings
      GROUP BY bucket
      ORDER BY bucket
    `,
  })

  return result.rows.map((row) => ({
    name: row.bucket,
    creationDate: row.created_at,
  }))
}

export const s3ObjectMappingsRepository = {
  createMapping,
  findByKey,
  updateMapping,
  findByCid,
  listBuckets,
}
