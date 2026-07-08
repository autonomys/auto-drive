import { S3ObjectListing } from '@autonomys/file-server'
import { getDatabase } from '../../drivers/pg.js'
import { ownershipSQL } from '../objects/ownership.js'

export type { S3ObjectListing }

export interface S3KeyMapping {
  bucket: string
  key: string
  cid: string
  /** MD5 hex digest of the object body, or null for objects uploaded before this feature. */
  md5: string | null
  /**
   * Client-supplied modification time (rclone sends it as the x-amz-meta-mtime
   * header, a float unix-seconds string). Stored verbatim so it round-trips with
   * full precision; null means the object has no client mtime.
   */
  mtime: string | null
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
  md5: S3KeyMapping['md5']
  mtime: S3KeyMapping['mtime']
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
  mtime: db.mtime ?? null,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
})

const createMapping = async (
  bucket: string,
  s3Key: string,
  cid: string,
  md5: string | null = null,
  mtime: string | null = null,
): Promise<S3KeyMapping> => {
  const db = await getDatabase()

  // ON CONFLICT resets deleted_at to NULL so a PutObject to a previously
  // soft-deleted key resurrects it — matching S3's "PUT after DELETE re-creates
  // the object" semantics (and TestObjectUpdate, which overwrites in place).
  const result = await db.query<S3KeyMappingDB>({
    text: `
      INSERT INTO "S3".object_mappings
      (bucket, "key", cid, md5, mtime)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (bucket, "key") DO UPDATE
        SET cid = $3, md5 = $4, mtime = $5, deleted_at = NULL, updated_at = NOW()
      RETURNING *
    `,
    values: [bucket, s3Key, cid, md5, mtime],
  })

  return result.rows.map(mapDBToDomain)[0]
}

const findByKey = async (
  bucket: string,
  s3Key: string,
): Promise<S3KeyMapping | null> => {
  const db = await getDatabase()

  // Soft-deleted mappings read as "not found": GET / HEAD / CopyObject source
  // lookups and objectExists all go through findByKey, so a deleted key returns
  // 404 / NoSuchKey everywhere without a per-caller filter.
  const result = await db.query<S3KeyMappingDB>({
    text: `
      SELECT * FROM "S3".object_mappings
      WHERE bucket = $1 AND "key" = $2 AND deleted_at IS NULL
    `,
    values: [bucket, s3Key],
  })

  if (result.rows.length === 0) {
    return null
  }

  return result.rows.map(mapDBToDomain)[0]
}

/**
 * Soft-delete a single (bucket, key) mapping (S3 DeleteObject). Sets deleted_at
 * so the key is hidden from every read path; the underlying content is never
 * removed from the DSN. Idempotent: deleting an already-deleted or non-existent
 * key is a no-op (S3 DeleteObject succeeds regardless). Returns the cid of the
 * row it just soft-deleted, or null if there was no active row — the caller uses
 * this to decide whether to also move the underlying object to the UI Trash.
 */
const softDeleteMapping = async (
  bucket: string,
  s3Key: string,
): Promise<{ cid: string } | null> => {
  const db = await getDatabase()

  const result = await db.query<{ cid: string }>({
    text: `
      UPDATE "S3".object_mappings
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE bucket = $1 AND "key" = $2 AND deleted_at IS NULL
      RETURNING cid
    `,
    values: [bucket, s3Key],
  })

  return result.rows[0] ?? null
}

/**
 * Clear the soft-delete flag on mappings pointing at a cid. Called when the
 * underlying object is restored from the web-app Trash so that S3 keys hidden by
 * a DeleteObject reappear too — the reverse of deleteObject's propagation to the
 * Trash, keeping the S3 namespace and the UI in sync ("unified with UI Trash").
 *
 * When `since` is given, only keys soft-deleted at/after that instant are
 * restored. deleteObject stamps the object's Trash time (ownership) BEFORE it
 * hides the mapping, so the triggering key's deleted_at is >= the Trash time,
 * while keys the owner had individually deleted earlier stay hidden — restore
 * brings back what this trash removed, not every alias that ever pointed here.
 */
const restoreMappingsByCid = async (
  cid: string,
  since: Date | null = null,
): Promise<void> => {
  const db = await getDatabase()

  if (since) {
    await db.query({
      text: `
        UPDATE "S3".object_mappings
        SET deleted_at = NULL, updated_at = NOW()
        WHERE cid = $1 AND deleted_at IS NOT NULL AND deleted_at >= $2
      `,
      values: [cid, since],
    })
    return
  }

  await db.query({
    text: `
      UPDATE "S3".object_mappings
      SET deleted_at = NULL, updated_at = NOW()
      WHERE cid = $1 AND deleted_at IS NOT NULL
    `,
    values: [cid],
  })
}

/**
 * Count active (non-soft-deleted) mappings pointing at a cid. Used after a
 * DeleteObject to decide whether any S3 key still references the content before
 * propagating the removal to the web-app Trash.
 */
const countActiveMappingsByCid = async (cid: string): Promise<number> => {
  const db = await getDatabase()

  const result = await db.query<{ count: string }>({
    text: `
      SELECT COUNT(*)::text AS count
      FROM "S3".object_mappings
      WHERE cid = $1 AND deleted_at IS NULL
    `,
    values: [cid],
  })

  return Number(result.rows[0]?.count ?? 0)
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

  // Only surface buckets that still have at least one visible object, mirroring
  // the ListObjectsV2 visibility rules: exclude soft-deleted mappings and
  // objects the owner has removed. A fully-purged bucket disappears.
  const result = await db.query<S3BucketInfoDB>({
    text: `
      SELECT om.bucket AS bucket, MIN(om.created_at) AS created_at
      FROM "S3".object_mappings om
      WHERE om.deleted_at IS NULL
        AND ${ownershipSQL.notRemovedByOwnerSQL('om.cid')}
      GROUP BY om.bucket
      ORDER BY om.bucket
    `,
  })

  return result.rows.map((row) => ({
    name: row.bucket,
    creationDate: row.created_at,
  }))
}

// ── Multipart upload mtime staging ────────────────────────────────────────
// rclone sends x-amz-meta-mtime on CreateMultipartUpload but not on Complete,
// and the mapping is only created at completion — so the mtime is stashed by
// upload id here and read back in completeMultipartUpload.

const setMultipartMtime = async (
  uploadId: string,
  mtime: string,
): Promise<void> => {
  const db = await getDatabase()
  await db.query({
    text: `
      INSERT INTO "S3".multipart_upload_meta (upload_id, mtime)
      VALUES ($1, $2)
      ON CONFLICT (upload_id) DO UPDATE SET mtime = $2
    `,
    values: [uploadId, mtime],
  })
}

const getMultipartMtime = async (
  uploadId: string,
): Promise<string | null> => {
  const db = await getDatabase()
  const result = await db.query<{ mtime: string }>({
    text: 'SELECT mtime FROM "S3".multipart_upload_meta WHERE upload_id = $1',
    values: [uploadId],
  })
  return result.rows[0]?.mtime ?? null
}

const deleteMultipartMtime = async (uploadId: string): Promise<void> => {
  const db = await getDatabase()
  await db.query({
    text: 'DELETE FROM "S3".multipart_upload_meta WHERE upload_id = $1',
    values: [uploadId],
  })
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
  // Hide objects whose owner has removed them (moved to Trash), mirroring
  // ObjectUseCases.isObjectDeleted: removal is tracked on the root upload's
  // ownership row, so the mapping's cid is resolved to its root before the
  // admin-ownership check. This keeps a removed folder's child objects hidden
  // even though they keep vestigial active admin rows from upload finalization.
  const baseSQL = `
    SELECT
      om.key,
      om.cid,
      om.md5,
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
      AND om.deleted_at IS NULL
      AND ${ownershipSQL.notRemovedByOwnerSQL('om.cid')}
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
    md5: string | null
    size: string // pg returns bigint as string
    updated_at: Date
  }>({ text, values })

  return result.rows.map((row) => ({
    key: row.key,
    cid: row.cid,
    size: BigInt(row.size),
    lastModified: row.updated_at,
    md5: row.md5 ?? null,
  }))
}

export const s3ObjectMappingsRepository = {
  createMapping,
  findByKey,
  softDeleteMapping,
  restoreMappingsByCid,
  countActiveMappingsByCid,
  setMultipartMtime,
  getMultipartMtime,
  deleteMultipartMtime,
  updateMapping,
  findByCid,
  listBuckets,
  listObjects,
}
