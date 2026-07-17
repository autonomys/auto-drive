import { s3ObjectMappingsRepository } from '../../infrastructure/repositories/index.js'
import { DownloadUseCase } from '../downloads/index.js'
import { ObjectUseCases } from '../objects/object.js'
import { err, ok, Result } from 'neverthrow'
import { ForbiddenError, ObjectNotFoundError } from '../../errors/index.js'
import {
  CompleteMultipartUploadCommandParams,
  CompleteMultipartUploadCommandResult,
  GetObjectCommandParams,
  GetObjectCommandResult,
  CreateMultipartUploadCommandParams,
  CreateMultipartUploadCommandResult,
  PutObjectCommandParams,
  PutObjectCommandResult,
  UploadPartCommandParams,
  UploadPartCommandResult,
} from '@auto-drive/s3'
import {
  computeListObjectsDbLimit,
  finalizeListObjects,
  formatETag,
  ListObjectsParams,
  ListObjectsResult,
  md5Hex,
  multipartETag,
} from '@autonomys/file-server'

// Local extensions to the shared DTOs — kept in the backend rather than
// the shared package so the package doesn't carry Autonomys-specific fields.

/** PutObject result extended with the Autonomys CID for the x-amz-meta-cid header. */
type PutObjectResult = PutObjectCommandResult & { Cid: string }

/** CompleteMultipartUpload result extended with the Autonomys CID.
 *
 *  `Location` is intentionally omitted here. Per the S3 spec it is the absolute
 *  URL of the new object, which depends on the public endpoint the client used
 *  (the dedicated S3 subdomain vs. the legacy /s3 path). That is request/host
 *  state the HTTP layer owns, so it is built in `completeMultipartUploadHandler`
 *  and this use case stays host-agnostic. */
type CompleteMultipartUploadResult = Omit<
  CompleteMultipartUploadCommandResult,
  'Location'
> & {
  Cid: string
}

/** CompleteMultipartUpload params extended with the per-part ETags needed to
 *  compute the composite S3 multipart ETag. */
type CompleteMultipartUploadParams = CompleteMultipartUploadCommandParams & {
  Parts?: Array<{ PartNumber: number; ETag: string }>
}

/** PutObject params extended with the client modification time (x-amz-meta-mtime)
 *  and the standard S3 object metadata captured from the request headers.
 *  Mtime is kept local rather than in the shared DTO — it is an rclone/tooling
 *  convention, not part of the standard S3 PutObject contract. */
type PutObjectParams = PutObjectCommandParams & {
  Mtime?: string | null
  Metadata?: S3ObjectMetadata | null
}

/** CreateMultipartUpload params extended with the client mtime and object
 *  metadata, both stashed by upload id so completeMultipartUpload can persist
 *  them (S3 sends them on create but not on complete). */
type CreateMultipartUploadParams = CreateMultipartUploadCommandParams & {
  Mtime?: string | null
  Metadata?: S3ObjectMetadata | null
}

/** CopyObject params. Source is resolved from the x-amz-copy-source header in
 *  the HTTP layer; Mtime carries an x-amz-meta-mtime when the client replaces
 *  metadata (rclone's SetModTime copies an object onto itself with a new mtime). */
type CopyObjectParams = {
  SourceBucket: string
  SourceKey: string
  Bucket: string
  Key: string
  /** When set, overrides the source mtime on the destination (metadata REPLACE). */
  Mtime?: string | null
  /**
   * Metadata directive for the destination. `undefined` means COPY: the
   * destination inherits the source metadata. A value (or explicit null) means
   * REPLACE: the destination's metadata is exactly this, discarding the source's.
   */
  Metadata?: S3ObjectMetadata | null
}

/** CopyObject result: the standard fields the <CopyObjectResult> body needs,
 *  plus the Autonomys CID for the x-amz-meta-cid header. */
type CopyObjectResult = {
  ETag: string
  LastModified: Date
  Cid: string
}
import { UploadsUseCases } from '../uploads/uploads.js'
import { UserWithOrganization } from '@auto-drive/models'
import { handleInternalError } from '../../shared/utils/neverthrow.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import {
  S3BucketInfo,
  S3KeyMapping,
  S3ObjectMetadata,
} from '../../infrastructure/repositories/s3/objectMappings.js'

const logger = createLogger('useCases:s3')

// The S3 key namespace is scoped per user: (owner, bucket, key) is the mapping
// identity, so every read/write below is scoped to the requesting user. There is
// no cross-user contention over a shared (bucket, key), hence no ownership gates,
// guarded upserts, or pre-finalize checks — the scoped findByKey/createMapping IS
// the boundary. The user's identity comes from handleS3Auth in the HTTP layer.

const listObjects = async (
  user: UserWithOrganization,
  params: ListObjectsParams,
): Promise<ListObjectsResult> => {
  const dbLimit = computeListObjectsDbLimit(params.maxKeys, params.delimiter)
  const allMatching = await s3ObjectMappingsRepository.listObjects(
    user.oauthProvider,
    user.oauthUserId,
    params.bucket,
    params.prefix,
    params.continuationToken,
    dbLimit,
  )
  return finalizeListObjects(params, allMatching, dbLimit)
}

// Extended result type for internal use — includes the CID so the HTTP layer
// can set the x-amz-meta-cid header without an extra DB lookup.
type GetObjectUseCaseResult = GetObjectCommandResult & {
  cid: string
  /** null for objects uploaded before MD5 ETag support was introduced. */
  etag: string | null
  /** The current version's write time (object_versions.created_at), surfaced as
   *  the S3 Last-Modified header — stable across soft-delete/restore, unlike
   *  the mapping's updated_at. */
  lastModified: Date
  /**
   * Client-supplied modification time (x-amz-meta-mtime), echoed back verbatim
   * so tools like rclone read the same value they wrote. null when unset.
   */
  mtime: string | null
  /**
   * Stored S3 object metadata (Content-Type, Cache-Control, x-amz-meta-*, …),
   * emitted verbatim on the response by the HTTP layer. null for objects written
   * before metadata persistence (they fall back to the IPLD-derived headers).
   */
  objectMetadata: S3ObjectMetadata | null
}

/** GetObject params extended with an optional versionId (the CID of a specific
 *  version). Kept local — versioning is an Autonomys extension over the shared
 *  DTO, and versionId maps to the content CID. */
type GetObjectParams = GetObjectCommandParams & { VersionId?: string }

const getObject = async (
  user: UserWithOrganization,
  params: GetObjectParams,
): Promise<Result<GetObjectUseCaseResult, ObjectNotFoundError>> => {
  // Versioned read (GET/HEAD ?versionId=<cid>): fetch the specific version's
  // content by CID rather than the current pointer. The version must belong to
  // this key in the caller's namespace; the download itself still runs the
  // moderation/ban checks (downloadObjectByAnonymous → authorizeDownload), so a
  // removed/banned version is not retrievable even though it is retained.
  if (params.VersionId) {
    const version = await s3ObjectMappingsRepository.findVersionByCid(
      user.oauthProvider,
      user.oauthUserId,
      params.Bucket,
      params.Key,
      params.VersionId,
    )
    if (!version) {
      return err(
        new ObjectNotFoundError(
          `Version ${params.VersionId} of ${params.Bucket}/${params.Key} not found`,
        ),
      )
    }
    const versionedDownload = await DownloadUseCase.downloadObjectByAnonymous(
      version.cid,
      { byteRange: params.Range },
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (versionedDownload as any).map((dl: GetObjectCommandResult) => ({
      ...dl,
      cid: version.cid,
      etag: version.md5 ? formatETag(version.md5) : null,
      lastModified: version.createdAt,
      mtime: version.mtime,
      objectMetadata: version.metadata,
    }))
  }

  const mapping = await s3ObjectMappingsRepository.findByKey(
    user.oauthProvider,
    user.oauthUserId,
    params.Bucket,
    params.Key,
  )
  if (!mapping) {
    return err(
      new ObjectNotFoundError(`Object ${params.Bucket}/${params.Key} not found`),
    )
  }

  // Anchor Last-Modified to the current version's immutable write time, not
  // mapping.updatedAt: a BEFORE UPDATE trigger bumps updated_at on soft-delete
  // and Trash restore (which write no new version), so it would drift after a
  // restore and disagree with GET/HEAD ?versionId and ListObjectVersions, which
  // read object_versions.created_at. Mirrors getObjectWriteTime; falls back to
  // updatedAt for legacy rows with no version history.
  const currentVersion = await s3ObjectMappingsRepository.findVersionByCid(
    user.oauthProvider,
    user.oauthUserId,
    params.Bucket,
    params.Key,
    mapping.cid,
  )
  const lastModified = currentVersion?.createdAt ?? mapping.updatedAt

  const downloadResult = await DownloadUseCase.downloadObjectByAnonymous(
    mapping.cid,
    { byteRange: params.Range },
  )

  // Use .map() to attach cid/etag to the ok value and propagate any error
  // unchanged. The error type from downloadObjectByAnonymous is wider than
  // ObjectNotFoundError but handleError in the controller accepts any Error.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (downloadResult as any).map((dl: GetObjectCommandResult) => ({
    ...dl,
    cid: mapping.cid,
    // Objects uploaded before this feature have null md5; fall back to null
    // so the controller can omit the ETag header for legacy objects.
    etag: mapping.md5 ? formatETag(mapping.md5) : null,
    lastModified,
    mtime: mapping.mtime,
    objectMetadata: mapping.metadata,
  }))
}

// ── ListObjectVersions ─────────────────────────────────────────────────────

export interface S3VersionEntry {
  key: string
  /** versionId = the content CID. */
  versionId: string
  isLatest: boolean
  lastModified: Date
  /** Quoted ETag: the MD5 when known, else the CID (matching GET/HEAD/List). */
  etag: string
  size: bigint
}

export interface S3DeleteMarkerEntry {
  key: string
  versionId: string
  isLatest: boolean
  lastModified: Date
}

export interface ListObjectVersionsParams {
  bucket: string
  prefix: string
  keyMarker: string | null
  maxKeys: number
}

export interface ListObjectVersionsResult {
  versions: S3VersionEntry[]
  deleteMarkers: S3DeleteMarkerEntry[]
  isTruncated: boolean
  nextKeyMarker: string | null
}

// A synthesised delete marker's versionId. Markers are not stored — they are
// derived from the mapping's deleted_at — so their id is derived too, from the
// delete time. The same value is reported by ListObjectVersions and on the
// DeleteObject response for a given delete. Display-only: a ?versionId=dm-…
// GET/DELETE still 404s/403s (a version can't be fetched or destroyed by it).
const deleteMarkerVersionId = (deletedAt: Date): string =>
  `dm-${deletedAt.getTime()}`

/**
 * ListObjectVersions: enumerate the version history for a bucket/prefix in the
 * caller's namespace, newest version first per key. IsLatest marks the current
 * content version of each live key; for a key whose current pointer is
 * soft-deleted, a delete marker is synthesised as the latest entry (its
 * versionId derived from the delete time — markers are display-only, since
 * DeleteObject?versionId always 403s). Pagination is key-level: up to maxKeys
 * keys are returned, with nextKeyMarker set when more remain. The repository
 * returns WHOLE keys (every version row of up to maxKeys + 1 distinct keys), so
 * a key's history is never split across a page boundary.
 *
 * KNOWN LIMITATION (tracked in #790): maxKeys bounds the number of distinct KEYS,
 * not entries. S3 defines max-keys as a hard bound on Version+DeleteMarker
 * entries with version-id-marker resume; here a single key with > maxKeys
 * versions returns them all in one page. This is deliberate — whole keys are
 * never split, so no version is silently dropped (the higher-severity concern) —
 * at the cost of an oversized page for a pathologically-overwritten key. Proper
 * entry-level pagination is deferred: it needs an opaque object_versions.id
 * cursor (versionId=CID isn't monotonic) plus SQL-level DISTINCT ON dedup, per
 * #790.
 */
const getObjectVersions = async (
  user: UserWithOrganization,
  params: ListObjectVersionsParams,
): Promise<ListObjectVersionsResult> => {
  // maxKeys + 1: the extra key (if any) signals more history to page through.
  // Because whole keys are fetched, that extra key is complete too — nothing is
  // cut, so paging with `key > nextKeyMarker` can't skip any of a key's history.
  const rows = await s3ObjectMappingsRepository.listObjectVersions(
    user.oauthProvider,
    user.oauthUserId,
    params.bucket,
    params.prefix,
    params.keyMarker,
    params.maxKeys + 1,
  )

  const versions: S3VersionEntry[] = []
  const deleteMarkers: S3DeleteMarkerEntry[] = []
  let keysEmitted = 0
  let lastKey: string | null = null
  let isTruncated = false

  // Rows arrive ordered by key asc, then newest version first, so a key's rows
  // are contiguous and the first row of each key is its newest version.
  let i = 0
  while (i < rows.length) {
    const key = rows[i].key
    // New key: enforce the maxKeys page limit before emitting its group. Since
    // maxKeys + 1 keys were fetched, seeing another key here means more remain.
    if (keysEmitted >= params.maxKeys) {
      isTruncated = true
      break
    }
    const isDeleted = rows[i].pointerDeletedAt != null
    // versionId = CID, so multiple rows sharing a CID (repeated same-content
    // writes — e.g. an mtime-only copy-to-self) are ONE version. Collapse them,
    // keeping the newest occurrence (first in id-desc order) and its metadata.
    const seenCids = new Set<string>()
    let isNewestOfKey = true
    while (i < rows.length && rows[i].key === key) {
      const row = rows[i]
      i++
      if (seenCids.has(row.cid)) continue
      seenCids.add(row.cid)
      versions.push({
        key: row.key,
        versionId: row.cid,
        isLatest: isNewestOfKey && !isDeleted,
        lastModified: row.lastModified,
        etag: row.md5 ? `"${row.md5}"` : `"${row.cid}"`,
        size: row.size,
      })
      isNewestOfKey = false
    }
    if (isDeleted) {
      const deletedAt = rows[i - 1].pointerDeletedAt as Date
      deleteMarkers.push({
        key,
        versionId: deleteMarkerVersionId(deletedAt),
        isLatest: true,
        lastModified: deletedAt,
      })
    }
    keysEmitted++
    lastKey = key
  }

  return {
    versions,
    deleteMarkers,
    isTruncated,
    nextKeyMarker: isTruncated ? lastKey : null,
  }
}

const createMultipartUpload = async (
  user: UserWithOrganization,
  params: CreateMultipartUploadParams,
): Promise<Result<CreateMultipartUploadCommandResult, ObjectNotFoundError>> => {
  const name = params.Key.split('/').pop()!
  const upload = await UploadsUseCases.createFileUpload(
    user,
    name,
    params.ContentType ?? null,
    params.UploadOptions ?? null,
    null,
    null,
  )

  // Stash the client mtime and object metadata (if any) so
  // completeMultipartUpload can persist them onto the mapping — S3 sends them
  // here, on create, not on completion. Skip the write when there is nothing to
  // stash so uploads that carry neither don't touch the staging table.
  const mtime = params.Mtime ?? null
  const metadata = params.Metadata ?? null
  if (mtime || metadata) {
    await s3ObjectMappingsRepository.setMultipartMeta(upload.id, mtime, metadata)
  }

  return ok({
    UploadId: upload.id,
    Bucket: params.Bucket,
    Key: params.Key,
  })
}

const uploadPart = async (
  user: UserWithOrganization,
  params: UploadPartCommandParams,
): Promise<Result<UploadPartCommandResult, ObjectNotFoundError>> => {
  // AWS uses 1-indexed part numbers; we use 0-indexed internally.
  const zeroIndexedPartNumber = params.PartNumber - 1

  await UploadsUseCases.uploadChunk(
    user,
    params.UploadId,
    zeroIndexedPartNumber,
    params.Body,
  )

  // Return the MD5 of the part body as the ETag. The client echoes these back
  // in CompleteMultipartUpload so we can compute the composite ETag.
  return ok({
    ETag: formatETag(md5Hex(params.Body)),
  })
}

const completeMultipartUpload = async (
  user: UserWithOrganization,
  params: CompleteMultipartUploadParams,
): Promise<Result<CompleteMultipartUploadResult, ObjectNotFoundError>> => {
  const cid = await UploadsUseCases.completeUpload(user, params.UploadId)

  // Compute the composite multipart ETag from the per-part MD5s the client
  // sent back in the request. If no parts were provided (e.g. old/broken
  // clients), fall back to the CID so the response is still well-formed.
  const partETags = params.Parts?.map((p) => p.ETag) ?? []
  const hasValidParts = partETags.length > 0
  const etag = hasValidParts ? multipartETag(partETags) : `"${cid}"`

  // Only persist an md5 when we have real per-part ETags to compute from.
  // Storing null for the no-parts fallback keeps the md5 column's contract
  // (valid composite hex or null) and prevents the CID from being mistaken
  // for an MD5 on subsequent GET/HEAD requests.
  const md5ForStorage = hasValidParts ? etag.replace(/"/g, '') : null

  // Persist the mtime and object metadata stashed at CreateMultipartUpload, then
  // clear the staging row. Both are null when the client sent neither.
  const { mtime, metadata } = await s3ObjectMappingsRepository.getMultipartMeta(
    params.UploadId,
  )

  const mapping = await s3ObjectMappingsRepository.createMapping(
    user.oauthProvider,
    user.oauthUserId,
    params.Bucket,
    params.Key,
    cid,
    md5ForStorage,
    mtime,
    metadata,
  )
  await s3ObjectMappingsRepository.deleteMultipartMeta(params.UploadId)
  logger.debug(
    'Created mapping: bucket=(%s) key=(%s) -> cid=(%s) etag=(%s)',
    mapping.bucket,
    mapping.key,
    cid,
    etag,
  )

  return ok({
    Bucket: params.Bucket,
    Key: params.Key,
    ETag: etag,
    Cid: cid,
  })
}

const putObject = async (
  user: UserWithOrganization,
  params: PutObjectParams,
): Promise<Result<PutObjectResult, ObjectNotFoundError>> => {
  const name = params.Key.split('/').pop()!

  // Compute MD5 before upload so we have it ready for storage.
  const md5 = md5Hex(params.Body)

  const upload = await UploadsUseCases.createFileUpload(
    user,
    name,
    params.ContentType ?? null,
    params.UploadOptions ?? null,
    null,
    null,
  )

  const result = await handleInternalError(
    UploadsUseCases.uploadChunk(user, upload.id, 0, params.Body),
    'Failed to upload chunk',
  )
  if (result.isErr()) {
    return err(result.error)
  }

  const cid = await UploadsUseCases.completeUpload(user, upload.id)

  const mapping = await s3ObjectMappingsRepository.createMapping(
    user.oauthProvider,
    user.oauthUserId,
    params.Bucket,
    params.Key,
    cid,
    md5,
    params.Mtime ?? null,
    params.Metadata ?? null,
  )
  logger.debug(
    'Created mapping: bucket=(%s) key=(%s) -> cid=(%s) etag=(%s)',
    mapping.bucket,
    mapping.key,
    cid,
    formatETag(md5),
  )

  return ok({ ETag: formatETag(md5), Cid: cid })
}

/**
 * S3 DeleteObject — soft-delete the caller's (bucket, key) mapping. The content
 * is never removed from the Autonomys DSN; only the S3 name is hidden. Always
 * resolves to success (S3 returns 204 whether or not the key existed).
 *
 * The lookup is scoped to the caller, so a key that isn't theirs simply isn't
 * found (no cross-user authorization needed). When the deleted key was the
 * caller's LAST active mapping for its content, the object is also moved to
 * their web-app Trash (markAsDeleted) so an rclone delete is reflected in the UI
 * and stays recoverable — the "unified with UI Trash" behaviour.
 */
/** DeleteObject result: whether this call created a delete marker (soft-deleted
 *  an active key) and, if so, the marker's synthesised versionId. Surfaced as
 *  the x-amz-delete-marker / x-amz-version-id response headers so a
 *  versioning-aware client can tell a marker was written rather than data
 *  destroyed (which never happens on the DSN). */
interface DeleteObjectResult {
  deleteMarker: boolean
  versionId: string | null
}

const deleteObject = async (
  user: UserWithOrganization,
  bucket: string,
  key: string,
): Promise<Result<DeleteObjectResult, never>> => {
  const mapping = await s3ObjectMappingsRepository.findByKey(
    user.oauthProvider,
    user.oauthUserId,
    bucket,
    key,
  )

  // Not the caller's key (absent or already soft-deleted): nothing to do, so no
  // marker was created. DeleteObject is idempotent and returns success regardless.
  if (!mapping) {
    return ok({ deleteMarker: false, versionId: null })
  }

  const trashObject = async () => {
    const result = await ObjectUseCases.markAsDeleted(user, mapping.cid)
    if (result.isErr()) {
      // The mapping is (or will be) hidden regardless; failure to also trash the
      // object must not fail the delete.
      logger.warn(
        'Could not move object to Trash on delete (cid=%s): %s',
        mapping.cid,
        result.error.message,
      )
    }
  }

  // Is this the caller's last active key for the content? The count is scoped to
  // the caller, and includes the still-active mapping being deleted, so <= 1
  // means it's their last one.
  const countActive = () =>
    s3ObjectMappingsRepository.countActiveMappingsByCid(
      user.oauthProvider,
      user.oauthUserId,
      mapping.cid,
    )

  const activeBefore = await countActive()
  const isLastKey = activeBefore <= 1

  if (isLastKey) {
    // Move the object to the web-app Trash BEFORE hiding the mapping, so its
    // deleted_at is stamped at/after the object's Trash time — restore then
    // un-hides this key but not earlier, individually-deleted aliases.
    await trashObject()
  }

  const softDeleted = await s3ObjectMappingsRepository.softDeleteMapping(
    user.oauthProvider,
    user.oauthUserId,
    bucket,
    key,
  )

  if (!isLastKey) {
    // Race guard: between the count above and this hide, a concurrent
    // DeleteObject (same user, e.g. rclone --transfers) may have removed the
    // sibling last key. Re-check now that ours is hidden; if none of the
    // caller's keys remain, this delete emptied the content and must move it to
    // Trash. (If two concurrent deletes both reach here, markAsDeleted is
    // effectively idempotent: the second is a harmless no-op.)
    const activeAfter = await countActive()
    if (activeAfter === 0) {
      await trashObject()
    }
  }

  logger.debug('Soft-deleted S3 mapping: bucket=(%s) key=(%s)', bucket, key)
  // A delete marker was created iff this call actually hid an active row. (A
  // concurrent delete may have hidden it first — softDeleteMapping then returns
  // null and this call created nothing.)
  return ok(
    softDeleted
      ? {
          deleteMarker: true,
          versionId: deleteMarkerVersionId(softDeleted.deletedAt),
        }
      : { deleteMarker: false, versionId: null },
  )
}

/**
 * S3 CopyObject — copy the caller's source (bucket, key) to a destination key.
 * In content-addressed storage this is a cheap remap: the destination mapping
 * points at the source's cid, with no data transfer. This is what makes rclone
 * server-side copy and move work (rclone implements Move as Copy + Remove).
 *
 * The source lookup is scoped to the caller, so you can only copy your own keys.
 * mtime: with the default COPY metadata directive the destination inherits the
 * source mtime; when the client sends an x-amz-meta-mtime (metadata REPLACE, as
 * rclone's SetModTime does by copying an object onto itself) that value wins.
 */
const copyObject = async (
  user: UserWithOrganization,
  params: CopyObjectParams,
): Promise<Result<CopyObjectResult, ObjectNotFoundError>> => {
  const source = await s3ObjectMappingsRepository.findByKey(
    user.oauthProvider,
    user.oauthUserId,
    params.SourceBucket,
    params.SourceKey,
  )
  if (!source) {
    return err(
      new ObjectNotFoundError(
        `Object ${params.SourceBucket}/${params.SourceKey} not found`,
      ),
    )
  }

  // Don't copy a source that isn't actually readable (owner-removed via the web
  // app, banned, or otherwise blocked) into a new key that would then 404/451 on
  // read. Treat as NoSuchKey.
  const authorized = await ObjectUseCases.authorizeDownload(source.cid)
  if (authorized.isErr()) {
    return err(
      new ObjectNotFoundError(
        `Object ${params.SourceBucket}/${params.SourceKey} not found`,
      ),
    )
  }

  const mtime = params.Mtime !== undefined ? params.Mtime : source.mtime

  // Metadata directive: undefined ⇒ COPY (inherit the source's metadata); a
  // value or explicit null ⇒ REPLACE (the destination's metadata is exactly what
  // the request carried, discarding the source's). Mirrors the mtime handling.
  const metadata =
    params.Metadata !== undefined ? params.Metadata : source.metadata

  // The destination key is created in the caller's namespace.
  const mapping = await s3ObjectMappingsRepository.createMapping(
    user.oauthProvider,
    user.oauthUserId,
    params.Bucket,
    params.Key,
    source.cid,
    source.md5,
    mtime,
    metadata,
  )

  logger.debug(
    'Copied S3 mapping: %s/%s -> %s/%s (cid=%s)',
    params.SourceBucket,
    params.SourceKey,
    params.Bucket,
    params.Key,
    source.cid,
  )

  return ok({
    // Mirror GET/HEAD: MD5 ETag when known, else the CID for legacy objects.
    ETag: source.md5 ? formatETag(source.md5) : `"${source.cid}"`,
    LastModified: mapping.updatedAt,
    Cid: source.cid,
  })
}

const abortMultipartUpload = async (
  user: UserWithOrganization,
  uploadId: string,
): Promise<Result<void, ObjectNotFoundError | ForbiddenError>> => {
  const result = await UploadsUseCases.abortUpload(user, uploadId)
  // Clear any stashed metadata for this upload once it's genuinely aborted (only
  // on success, so a forbidden/unknown abort doesn't drop another upload's row).
  if (result.isOk()) {
    await s3ObjectMappingsRepository.deleteMultipartMeta(uploadId)
  }
  return result
}

const listBuckets = async (
  user: UserWithOrganization,
): Promise<S3BucketInfo[]> => {
  return s3ObjectMappingsRepository.listBuckets(
    user.oauthProvider,
    user.oauthUserId,
  )
}

// The caller's mapping for (bucket, key) IF it exists and is not hidden by
// owner-removal. A mapping the owner has since removed via the web app (moved to
// Trash) is treated as not found by GET and ListObjects (notRemovedByOwnerSQL /
// isObjectDeleted); mirror that here so the object-lock endpoints
// (GetObjectRetention / GetObjectLegalHold) don't report on a hidden key.
const findVisibleMapping = async (
  user: UserWithOrganization,
  bucket: string,
  key: string,
): Promise<S3KeyMapping | null> => {
  const mapping = await s3ObjectMappingsRepository.findByKey(
    user.oauthProvider,
    user.oauthUserId,
    bucket,
    key,
  )
  if (!mapping) return null
  if (await ObjectUseCases.isObjectDeleted(mapping.cid)) return null
  return mapping
}

const objectExists = async (
  user: UserWithOrganization,
  bucket: string,
  key: string,
): Promise<boolean> => (await findVisibleMapping(user, bucket, key)) !== null

// The current version's write time, or null when the key isn't visible. Object
// Lock retention anchors its COMPLIANCE window to when the content was written
// (RetainUntilDate = write time + the retention years), so GetObjectRetention
// needs this rather than a bare existence check.
//
// Anchored to the current version's object_versions.created_at, NOT the mapping's
// updated_at: a soft-delete or Trash restore (restoreMappingsByCid) bumps
// updated_at to now WITHOUT writing a new version, which would drift the
// RetainUntilDate to the restore instant. The version row's created_at is stamped
// once at write and never moves. Fall back to updated_at only for legacy objects
// with no version row (pre-#781 data the backfill didn't cover).
const getObjectWriteTime = async (
  user: UserWithOrganization,
  bucket: string,
  key: string,
): Promise<Date | null> => {
  const mapping = await findVisibleMapping(user, bucket, key)
  if (!mapping) return null
  const version = await s3ObjectMappingsRepository.findVersionByCid(
    user.oauthProvider,
    user.oauthUserId,
    bucket,
    key,
    mapping.cid,
  )
  return version ? version.createdAt : mapping.updatedAt
}

export const S3UseCases = {
  getObject,
  getObjectVersions,
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  putObject,
  deleteObject,
  copyObject,
  abortMultipartUpload,
  listBuckets,
  listObjects,
  objectExists,
  getObjectWriteTime,
}
