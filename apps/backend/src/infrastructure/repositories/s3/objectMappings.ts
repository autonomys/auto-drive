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
  /**
   * The user who owns this key. Part of the mapping's identity: the S3 namespace
   * is scoped per user — (owner, bucket, key) is unique — so users never contend
   * over a shared (bucket, key) and every read/write is scoped to the caller.
   */
  ownerOauthProvider: string
  ownerOauthUserId: string
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
  owner_oauth_provider: S3KeyMapping['ownerOauthProvider']
  owner_oauth_user_id: S3KeyMapping['ownerOauthUserId']
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
  ownerOauthProvider: db.owner_oauth_provider,
  ownerOauthUserId: db.owner_oauth_user_id,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
})

const createMapping = async (
  ownerOauthProvider: string,
  ownerOauthUserId: string,
  bucket: string,
  s3Key: string,
  cid: string,
  md5: string | null = null,
  mtime: string | null = null,
): Promise<S3KeyMapping> => {
  const db = await getDatabase()

  // Plain upsert keyed on (owner, bucket, key): a user can only ever hit their
  // OWN row, so there is no cross-user contention to guard against. ON CONFLICT
  // resets deleted_at to NULL so a PutObject to a previously soft-deleted key
  // resurrects it — S3's "PUT after DELETE re-creates the object" (and
  // TestObjectUpdate, which overwrites in place).
  const result = await db.query<S3KeyMappingDB>({
    text: `
      INSERT INTO "S3".object_mappings
      (owner_oauth_provider, owner_oauth_user_id, bucket, "key", cid, md5, mtime)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (owner_oauth_provider, owner_oauth_user_id, bucket, "key")
        DO UPDATE SET cid = $5, md5 = $6, mtime = $7,
          deleted_at = NULL, updated_at = NOW()
      RETURNING *
    `,
    values: [ownerOauthProvider, ownerOauthUserId, bucket, s3Key, cid, md5, mtime],
  })

  return result.rows.map(mapDBToDomain)[0]
}

const findByKey = async (
  ownerOauthProvider: string,
  ownerOauthUserId: string,
  bucket: string,
  s3Key: string,
): Promise<S3KeyMapping | null> => {
  const db = await getDatabase()

  // Scoped to the caller's own namespace. Soft-deleted mappings read as "not
  // found": GET / HEAD / CopyObject source lookups and objectExists all go
  // through findByKey, so a deleted key returns 404 / NoSuchKey everywhere.
  const result = await db.query<S3KeyMappingDB>({
    text: `
      SELECT * FROM "S3".object_mappings
      WHERE owner_oauth_provider = $1 AND owner_oauth_user_id = $2
        AND bucket = $3 AND "key" = $4 AND deleted_at IS NULL
    `,
    values: [ownerOauthProvider, ownerOauthUserId, bucket, s3Key],
  })

  if (result.rows.length === 0) {
    return null
  }

  return result.rows.map(mapDBToDomain)[0]
}

/**
 * Soft-delete a single (owner, bucket, key) mapping (S3 DeleteObject). Sets
 * deleted_at so the key is hidden from every read path; the underlying content
 * is never removed from the DSN. Idempotent: deleting an already-deleted or
 * non-existent key is a no-op (S3 DeleteObject succeeds regardless). Returns the
 * cid of the row it just soft-deleted, or null if there was no active row — the
 * caller uses this to decide whether to also move the object to the UI Trash.
 */
const softDeleteMapping = async (
  ownerOauthProvider: string,
  ownerOauthUserId: string,
  bucket: string,
  s3Key: string,
): Promise<{ cid: string } | null> => {
  const db = await getDatabase()

  const result = await db.query<{ cid: string }>({
    text: `
      UPDATE "S3".object_mappings
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE owner_oauth_provider = $1 AND owner_oauth_user_id = $2
        AND bucket = $3 AND "key" = $4 AND deleted_at IS NULL
      RETURNING cid
    `,
    values: [ownerOauthProvider, ownerOauthUserId, bucket, s3Key],
  })

  return result.rows[0] ?? null
}

/**
 * Clear the soft-delete flag on the caller's mappings pointing at a cid. Called
 * when the underlying object is restored from the web-app Trash so that S3 keys
 * hidden by a DeleteObject reappear too — the reverse of deleteObject's
 * propagation to the Trash, keeping the S3 namespace and the UI in sync.
 *
 * When `since` is given, only keys soft-deleted at/after that instant are
 * restored. deleteObject stamps the object's Trash time (ownership) BEFORE it
 * hides the mapping, so the triggering key's deleted_at is >= the Trash time,
 * while keys the owner had individually deleted earlier stay hidden — restore
 * brings back what this trash removed, not every alias that ever pointed here.
 */
const restoreMappingsByCid = async (
  ownerOauthProvider: string,
  ownerOauthUserId: string,
  cid: string,
  since: Date | null = null,
): Promise<void> => {
  const db = await getDatabase()

  const base = `
    UPDATE "S3".object_mappings
    SET deleted_at = NULL, updated_at = NOW()
    WHERE owner_oauth_provider = $1 AND owner_oauth_user_id = $2
      AND cid = $3 AND deleted_at IS NOT NULL
  `

  if (since) {
    await db.query({
      text: base + ' AND deleted_at >= $4',
      values: [ownerOauthProvider, ownerOauthUserId, cid, since],
    })
    return
  }

  await db.query({
    text: base,
    values: [ownerOauthProvider, ownerOauthUserId, cid],
  })
}

/**
 * Count the caller's active (non-soft-deleted) mappings pointing at a cid. Used
 * after a DeleteObject to decide whether any of the owner's S3 keys still
 * references the content before moving the object to their Trash. Scoped to the
 * owner: with content-addressed dedup another user may hold keys to the same
 * cid, and their keys must not affect this owner's "last key" decision.
 */
const countActiveMappingsByCid = async (
  ownerOauthProvider: string,
  ownerOauthUserId: string,
  cid: string,
): Promise<number> => {
  const db = await getDatabase()

  const result = await db.query<{ count: string }>({
    text: `
      SELECT COUNT(*)::text AS count
      FROM "S3".object_mappings
      WHERE owner_oauth_provider = $1 AND owner_oauth_user_id = $2
        AND cid = $3 AND deleted_at IS NULL
    `,
    values: [ownerOauthProvider, ownerOauthUserId, cid],
  })

  return Number(result.rows[0]?.count ?? 0)
}

const listBuckets = async (
  ownerOauthProvider: string,
  ownerOauthUserId: string,
): Promise<S3BucketInfo[]> => {
  const db = await getDatabase()

  // The caller's buckets only, and only those with at least one visible object
  // (mirroring ListObjectsV2: exclude soft-deleted mappings and objects the
  // owner removed via the web app). A fully-purged bucket disappears.
  const result = await db.query<S3BucketInfoDB>({
    text: `
      SELECT om.bucket AS bucket, MIN(om.created_at) AS created_at
      FROM "S3".object_mappings om
      WHERE om.owner_oauth_provider = $1 AND om.owner_oauth_user_id = $2
        AND om.deleted_at IS NULL
        AND ${ownershipSQL.notRemovedByOwnerSQL('om.cid')}
      GROUP BY om.bucket
      ORDER BY om.bucket
    `,
    values: [ownerOauthProvider, ownerOauthUserId],
  })

  return result.rows.map((row) => ({
    name: row.bucket,
    creationDate: row.created_at,
  }))
}

// ── Multipart upload mtime staging ────────────────────────────────────────
// rclone sends x-amz-meta-mtime on CreateMultipartUpload but not on Complete,
// and the mapping is only created at completion — so the mtime is stashed by
// upload id here and read back in completeMultipartUpload. Keyed by the (unique)
// upload id, so no owner scoping is needed.

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
  ownerOauthProvider: string,
  ownerOauthUserId: string,
  bucket: string,
  prefix: string,
  continuationToken: string | null,
  limit: number,
): Promise<S3ObjectListing[]> => {
  const db = await getDatabase()

  // Scoped to the caller's namespace. LATERAL subquery picks at most one
  // metadata row per object mapping. A plain LEFT JOIN on head_cid would fan out
  // when the same CID appears as head_cid in multiple metadata rows (different
  // root_cid values). notRemovedByOwnerSQL also hides objects the owner removed
  // via the web app (Trash), keeping the S3 listing consistent with the UI.
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
    WHERE om.owner_oauth_provider = $1
      AND om.owner_oauth_user_id = $2
      AND om.bucket = $3
      AND om.key LIKE $4
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
    text = baseSQL + ' AND om.key > $5 ORDER BY om.key LIMIT $6'
    values = [
      ownerOauthProvider,
      ownerOauthUserId,
      bucket,
      `${escapedPrefix}%`,
      continuationToken,
      limit,
    ]
  } else {
    text = baseSQL + ' ORDER BY om.key LIMIT $5'
    values = [
      ownerOauthProvider,
      ownerOauthUserId,
      bucket,
      `${escapedPrefix}%`,
      limit,
    ]
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
  listBuckets,
  listObjects,
}
