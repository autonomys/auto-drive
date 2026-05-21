import { getDatabase } from '../../drivers/pg.js'

export interface S3KeyMapping {
  bucket: string
  key: string
  cid: string
  /** MD5 hex digest of the object body, or null for objects uploaded before this feature. */
  md5: string | null
  createdAt: Date
  updatedAt: Date
}

export interface S3BucketInfo {
  name: string
  creationDate: Date
}

/** A single object entry returned by ListObjectsV2. */
export interface S3ObjectListing {
  key: string
  cid: string
  /** Object size in bytes joined from the metadata table; 0 when not yet indexed. */
  size: bigint
  lastModified: Date
}

interface S3KeyMappingDB {
  bucket: S3KeyMapping['bucket']
  key: S3KeyMapping['key']
  cid: S3KeyMapping['cid']
  md5: S3KeyMapping['md5']
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
  md5: db.md5 ?? null,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
})

const createMapping = async (
  bucket: string,
  s3Key: string,
  cid: string,
  md5: string | null = null,
): Promise<S3KeyMapping> => {
  const db = await getDatabase()

  const result = await db.query<S3KeyMappingDB>({
    text: `
      INSERT INTO "S3".object_mappings
      (bucket, "key", cid, md5)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (bucket, "key") DO UPDATE SET cid = $3, md5 = $4, updated_at = NOW()
      RETURNING *
    `,
    values: [bucket, s3Key, cid, md5],
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
  md5: string | null = null,
): Promise<S3KeyMapping> => {
  const db = await getDatabase()

  const result = await db.query<S3KeyMappingDB>({
    text: `
      UPDATE "S3".object_mappings
      SET cid = $3, md5 = $4, updated_at = NOW()
      WHERE bucket = $1 AND "key" = $2
      RETURNING *
    `,
    values: [bucket, s3Key, newCid, md5],
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

const listObjects = async (
  bucket: string,
  prefix: string,
  continuationToken: string | null,
  limit: number,
): Promise<S3ObjectListing[]> => {
  const db = await getDatabase()

  // LATERAL subquery picks at most one metadata row per object mapping.
  // A plain LEFT JOIN on head_cid would fan out when the same CID appears
  // as head_cid in multiple metadata rows (different root_cid values), which
  // can happen when the same content is referenced by more than one root upload.
  const baseSQL = `
    SELECT
      om.key,
      om.cid,
      COALESCE(m.total_size, 0) AS size,
      om.updated_at
    FROM "S3".object_mappings om
    LEFT JOIN LATERAL (
      SELECT (metadata->>'totalSize')::bigint AS total_size
      FROM metadata
      WHERE head_cid = om.cid
      LIMIT 1
    ) m ON true
    WHERE om.bucket = $1
      AND om.key LIKE $2
  `

  // Escape LIKE special characters so literal occurrences in the prefix
  // don't accidentally match unrelated keys. Backslash must be escaped first
  // (before we introduce new backslashes for % and _).
  const escapedPrefix = prefix
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')

  let text: string
  let values: unknown[]
  if (continuationToken) {
    text = baseSQL + ' AND om.key > $3 ORDER BY om.key LIMIT $4'
    values = [bucket, `${escapedPrefix}%`, continuationToken, limit]
  } else {
    text = baseSQL + ' ORDER BY om.key LIMIT $3'
    values = [bucket, `${escapedPrefix}%`, limit]
  }

  const result = await db.query<{
    key: string
    cid: string
    size: string // pg returns bigint as string
    updated_at: Date
  }>({ text, values })

  return result.rows.map((row) => ({
    key: row.key,
    cid: row.cid,
    size: BigInt(row.size),
    lastModified: row.updated_at,
  }))
}

export const s3ObjectMappingsRepository = {
  createMapping,
  findByKey,
  updateMapping,
  findByCid,
  listBuckets,
  listObjects,
}
