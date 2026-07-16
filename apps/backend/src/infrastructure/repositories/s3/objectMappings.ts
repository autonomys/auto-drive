import { S3ObjectListing } from '@autonomys/file-server'
import { getDatabase } from '../../drivers/pg.js'
import { ownershipSQL } from '../objects/ownership.js'

export type { S3ObjectListing }

/**
 * Standard S3 object metadata persisted per key, beside the content rather than
 * inside the content hash: it is a property of the S3 key, not of the bytes, so
 * two keys can point at the same CID with different declared metadata while
 * content-addressed dedup stays intact. All fields are optional — a field is
 * present only when the client set the corresponding header on write.
 *
 * Content-Type is stored here (verbatim) in addition to the IPLD node's mimeType
 * so GET/HEAD can return exactly what the client sent — byte-for-byte, with no
 * framework-injected charset — which the IPLD-derived value cannot guarantee.
 */
export interface S3ObjectMetadata {
  /** Verbatim Content-Type as supplied on write (no charset injected on read). */
  contentType?: string
  cacheControl?: string
  contentLanguage?: string
  contentDisposition?: string
  contentEncoding?: string
  /**
   * Arbitrary user metadata: the map of x-amz-meta-* entries keyed by the name
   * after the `x-amz-meta-` prefix (lowercased, as S3 stores them). Excludes the
   * reserved keys handled elsewhere (mtime, compression, encryption, cid).
   */
  userMetadata?: Record<string, string>
}

/**
 * One immutable entry in a key's append-only version history (issue #781).
 * versionId is the CID. Delete markers are NOT stored as version rows — the
 * "current key is deleted" state lives on the mapping's deleted_at and the
 * marker is synthesised from it at read time — so every version row is content.
 */
export interface S3ObjectVersion {
  bucket: string
  key: string
  cid: string
  md5: string | null
  mtime: string | null
  metadata: S3ObjectMetadata | null
  createdAt: Date
}

/**
 * A row of a ListObjectVersions query: a content version joined with its key's
 * current-pointer delete state (deleted_at), so the caller can compute IsLatest
 * and synthesise the delete marker. Rows come ordered by key asc, then newest
 * version first.
 */
export interface S3ObjectVersionListingRow {
  key: string
  cid: string
  md5: string | null
  size: bigint
  /** This version's write time — the S3 Version LastModified. */
  lastModified: Date
  /** The key's current-pointer deleted_at (same for every row of a key); null when live. */
  pointerDeletedAt: Date | null
}

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
   * Standard S3 object metadata (Content-Type, Cache-Control, x-amz-meta-*, …).
   * null for objects written before metadata persistence was introduced.
   */
  metadata: S3ObjectMetadata | null
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
  // pg parses a jsonb column into a JS object on read; null when unset.
  metadata: S3ObjectMetadata | null
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
  metadata: db.metadata ?? null,
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
  metadata: S3ObjectMetadata | null = null,
): Promise<S3KeyMapping> => {
  const db = await getDatabase()

  // Plain upsert keyed on (owner, bucket, key): a user can only ever hit their
  // OWN row, so there is no cross-user contention to guard against. ON CONFLICT
  // resets deleted_at to NULL so a PutObject to a previously soft-deleted key
  // resurrects it — S3's "PUT after DELETE re-creates the object" (and
  // TestObjectUpdate, which overwrites in place). Overwriting a key REPLACES its
  // metadata wholesale (metadata = $8), matching S3: a PUT redefines the object's
  // metadata rather than merging into what was there.
  //
  // The current-pointer upsert and the append to the immutable version history
  // (versionId = cid) are ONE statement via data-modifying CTEs, so they commit
  // atomically: a partial failure can never advance the pointer without also
  // writing the matching version row (which would leave the current object
  // unlistable by ListObjectVersions and un-fetchable by its own versionId).
  // PostgreSQL runs every data-modifying WITH clause exactly once, to completion,
  // whether or not the final SELECT reads it — so every write (PutObject,
  // CopyObject, CompleteMultipartUpload, and a PUT that resurrects a soft-deleted
  // key) records exactly one version. `getDatabase()` is a Pool, so two separate
  // queries here could land on different connections and auto-commit apart.
  const metadataJson = metadata ? JSON.stringify(metadata) : null

  const result = await db.query<S3KeyMappingDB>({
    text: `
      WITH upserted AS (
        INSERT INTO "S3".object_mappings
        (owner_oauth_provider, owner_oauth_user_id, bucket, "key", cid, md5, mtime, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (owner_oauth_provider, owner_oauth_user_id, bucket, "key")
          DO UPDATE SET cid = $5, md5 = $6, mtime = $7, metadata = $8,
            deleted_at = NULL, updated_at = NOW()
        RETURNING *
      ),
      versioned AS (
        INSERT INTO "S3".object_versions
          (owner_oauth_provider, owner_oauth_user_id, bucket, "key", cid, md5, mtime, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      )
      SELECT * FROM upserted
    `,
    values: [
      ownerOauthProvider,
      ownerOauthUserId,
      bucket,
      s3Key,
      cid,
      md5,
      mtime,
      metadataJson,
    ],
  })

  return result.rows.map(mapDBToDomain)[0]
}

/**
 * Look up a single version of a key by its CID (GET/HEAD ?versionId=<cid>).
 * Scoped to the caller's namespace. Returns the newest matching row if the same
 * content was written more than once (identical bytes ⇒ identical CID ⇒ the same
 * versionId), or null when the key never had that version.
 */
const findVersionByCid = async (
  ownerOauthProvider: string,
  ownerOauthUserId: string,
  bucket: string,
  s3Key: string,
  cid: string,
): Promise<S3ObjectVersion | null> => {
  const db = await getDatabase()
  const result = await db.query<{
    bucket: string
    key: string
    cid: string
    md5: string | null
    mtime: string | null
    metadata: S3ObjectMetadata | null
    created_at: Date
  }>({
    text: `
      SELECT bucket, "key", cid, md5, mtime, metadata, created_at
      FROM "S3".object_versions
      WHERE owner_oauth_provider = $1 AND owner_oauth_user_id = $2
        AND bucket = $3 AND "key" = $4 AND cid = $5
      ORDER BY id DESC
      LIMIT 1
    `,
    values: [ownerOauthProvider, ownerOauthUserId, bucket, s3Key, cid],
  })

  const row = result.rows[0]
  if (!row) return null
  return {
    bucket: row.bucket,
    key: row.key,
    cid: row.cid,
    md5: row.md5 ?? null,
    mtime: row.mtime ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.created_at,
  }
}

/**
 * List the version history for a bucket/prefix (ListObjectVersions), scoped to
 * the caller. Each content version is joined with its key's current-pointer
 * delete state so the caller can flag IsLatest and synthesise a delete marker
 * for keys whose current pointer is soft-deleted.
 *
 * Unlike ListObjectsV2, this deliberately does NOT hide soft-deleted or
 * web-app-Trashed keys: version history is the point of WORM versioning and
 * must persist through deletion (a deleted key still lists its versions + a
 * delete marker). Retention is unconditional; moderation applies to RETRIEVAL
 * (GET ?versionId runs authorizeDownload), not to listing metadata.
 *
 * Pagination is by KEY: `keyLimit` bounds the number of distinct keys, and ALL
 * version rows of each selected key are returned (ordered key asc, then newest
 * version first). Whole keys are selected — never a partial key — so the caller
 * can page by key with `key > marker` without ever dropping part of a key's
 * history. Pass keyLimit = maxKeys + 1 so the caller detects truncation via the
 * extra key. There is deliberately no flat row cap: one that cut a key mid-
 * history would make the next page silently skip the remainder.
 */
const listObjectVersions = async (
  ownerOauthProvider: string,
  ownerOauthUserId: string,
  bucket: string,
  prefix: string,
  keyMarker: string | null,
  keyLimit: number,
): Promise<S3ObjectVersionListingRow[]> => {
  const db = await getDatabase()

  const escapedPrefix = prefix
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')

  // Scope filter shared by the key-selection CTE and the row fetch. ov.key alone
  // is not unique across owners/buckets, so it is re-applied on the outer query.
  const scope = `
    ov.owner_oauth_provider = $1
    AND ov.owner_oauth_user_id = $2
    AND ov.bucket = $3
    AND ov.key LIKE $4
  `
  // $5 = keyLimit; $6 = keyMarker (present only when paging).
  const markerClause = keyMarker ? ' AND ov.key > $6' : ''

  // Pick the page's distinct keys first, then fetch every version row for
  // exactly those keys. Selecting whole keys (rather than a flat LIMIT on rows)
  // guarantees no key is truncated mid-history.
  const text = `
    WITH page_keys AS (
      SELECT DISTINCT ov.key
      FROM "S3".object_versions ov
      WHERE ${scope}${markerClause}
      ORDER BY ov.key ASC
      LIMIT $5
    )
    SELECT
      ov.key,
      ov.cid,
      ov.md5,
      COALESCE(m.total_size, 0) AS size,
      ov.created_at AS last_modified,
      om.deleted_at AS pointer_deleted_at
    FROM "S3".object_versions ov
    JOIN page_keys pk ON pk.key = ov.key
    JOIN "S3".object_mappings om
      ON om.owner_oauth_provider = ov.owner_oauth_provider
     AND om.owner_oauth_user_id = ov.owner_oauth_user_id
     AND om.bucket = ov.bucket
     AND om.key = ov.key
    LEFT JOIN LATERAL (
      SELECT (metadata->>'totalSize')::bigint AS total_size
      FROM metadata
      WHERE head_cid = ov.cid
      LIMIT 1
    ) m ON true
    WHERE ${scope}
    ORDER BY ov.key ASC, ov.id DESC
  `

  const values: unknown[] = keyMarker
    ? [
        ownerOauthProvider,
        ownerOauthUserId,
        bucket,
        `${escapedPrefix}%`,
        keyLimit,
        keyMarker,
      ]
    : [
        ownerOauthProvider,
        ownerOauthUserId,
        bucket,
        `${escapedPrefix}%`,
        keyLimit,
      ]

  const result = await db.query<{
    key: string
    cid: string
    md5: string | null
    size: string
    last_modified: Date
    pointer_deleted_at: Date | null
  }>({ text, values })

  return result.rows.map((row) => ({
    key: row.key,
    cid: row.cid,
    md5: row.md5 ?? null,
    size: BigInt(row.size),
    lastModified: row.last_modified,
    pointerDeletedAt: row.pointer_deleted_at ?? null,
  }))
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

// ── Multipart upload metadata staging ─────────────────────────────────────
// S3 sends the client mtime and system/user metadata on CreateMultipartUpload
// but NOT on CompleteMultipartUpload, and the mapping is only created at
// completion — so both are stashed by upload id here and read back in
// completeMultipartUpload. Keyed by the (unique) upload id, so no owner scoping
// is needed. Either value may be absent (an upload can carry metadata but no
// mtime, or vice versa); a row is written whenever at least one is present.

const setMultipartMeta = async (
  uploadId: string,
  mtime: string | null,
  metadata: S3ObjectMetadata | null,
): Promise<void> => {
  const db = await getDatabase()
  await db.query({
    text: `
      INSERT INTO "S3".multipart_upload_meta (upload_id, mtime, metadata)
      VALUES ($1, $2, $3)
      ON CONFLICT (upload_id) DO UPDATE SET mtime = $2, metadata = $3
    `,
    values: [uploadId, mtime, metadata ? JSON.stringify(metadata) : null],
  })
}

const getMultipartMeta = async (
  uploadId: string,
): Promise<{ mtime: string | null; metadata: S3ObjectMetadata | null }> => {
  const db = await getDatabase()
  const result = await db.query<{
    mtime: string | null
    metadata: S3ObjectMetadata | null
  }>({
    text: 'SELECT mtime, metadata FROM "S3".multipart_upload_meta WHERE upload_id = $1',
    values: [uploadId],
  })
  return {
    mtime: result.rows[0]?.mtime ?? null,
    metadata: result.rows[0]?.metadata ?? null,
  }
}

const deleteMultipartMeta = async (uploadId: string): Promise<void> => {
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
  findVersionByCid,
  listObjectVersions,
  softDeleteMapping,
  restoreMappingsByCid,
  countActiveMappingsByCid,
  setMultipartMeta,
  getMultipartMeta,
  deleteMultipartMeta,
  listBuckets,
  listObjects,
}
