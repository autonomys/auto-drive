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

/** PutObject params extended with the client modification time (x-amz-meta-mtime).
 *  Kept local rather than in the shared DTO — mtime is an rclone/tooling
 *  convention, not part of the standard S3 PutObject contract. */
type PutObjectParams = PutObjectCommandParams & { Mtime?: string | null }

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
import { S3BucketInfo } from '../../infrastructure/repositories/s3/objectMappings.js'

const logger = createLogger('useCases:s3')

const listObjects = async (
  params: ListObjectsParams,
): Promise<ListObjectsResult> => {
  const dbLimit = computeListObjectsDbLimit(params.maxKeys, params.delimiter)
  const allMatching = await s3ObjectMappingsRepository.listObjects(
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
  /** Mapping's last-write time, surfaced as the S3 Last-Modified header. */
  lastModified: Date
  /**
   * Client-supplied modification time (x-amz-meta-mtime), echoed back verbatim
   * so tools like rclone read the same value they wrote. null when unset.
   */
  mtime: string | null
}

const getObject = async (
  params: GetObjectCommandParams,
): Promise<Result<GetObjectUseCaseResult, ObjectNotFoundError>> => {
  const mapping = await s3ObjectMappingsRepository.findByKey(
    params.Bucket,
    params.Key,
  )
  if (!mapping) {
    return err(
      new ObjectNotFoundError(`Object ${params.Bucket}/${params.Key} not found`),
    )
  }

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
    lastModified: mapping.updatedAt,
    mtime: mapping.mtime,
  }))
}

const createMultipartUpload = async (
  user: UserWithOrganization,
  params: CreateMultipartUploadCommandParams,
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

  const mapping = await s3ObjectMappingsRepository.createMapping(
    params.Bucket,
    params.Key,
    cid,
    md5ForStorage,
  )
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
    params.Bucket,
    params.Key,
    cid,
    md5,
    params.Mtime ?? null,
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
 * S3 DeleteObject — soft-delete the (bucket, key) mapping. The content is never
 * removed from the Autonomys DSN; only the S3 name is hidden. Always resolves to
 * success (S3 returns 204 whether or not the key existed).
 *
 * Because a server-side copy/move only remaps `key -> same cid`, deletion is
 * tracked at the mapping level so that `move = copy + delete-source` keeps the
 * destination live. On top of that, when the deleted key was the LAST active S3
 * mapping for its content, the object is also moved to the owner's web-app Trash
 * (ObjectUseCases.markAsDeleted) so an rclone delete is reflected in the UI and
 * stays recoverable there — the "unified with UI Trash" behaviour.
 */
const deleteObject = async (
  user: UserWithOrganization,
  bucket: string,
  key: string,
): Promise<Result<void, never>> => {
  const deleted = await s3ObjectMappingsRepository.softDeleteMapping(
    bucket,
    key,
  )

  // No active mapping was removed (key absent or already deleted): nothing more
  // to do — DeleteObject is idempotent.
  if (!deleted) {
    return ok()
  }

  // If no other S3 key still references this content, propagate the removal to
  // the web-app Trash. markAsDeleted is owner-gated and no-ops for a
  // non-owner/unknown cid, so this is safe to call unconditionally here.
  const remaining = await s3ObjectMappingsRepository.countActiveMappingsByCid(
    deleted.cid,
  )
  if (remaining === 0) {
    const result = await ObjectUseCases.markAsDeleted(user, deleted.cid)
    if (result.isErr()) {
      // The mapping is already hidden; a failure to also trash the underlying
      // object (e.g. the caller isn't its owner) must not fail the delete.
      logger.warn(
        'Soft-deleted S3 mapping but could not move object to Trash (cid=%s): %s',
        deleted.cid,
        result.error.message,
      )
    }
  }

  logger.debug('Soft-deleted S3 mapping: bucket=(%s) key=(%s)', bucket, key)
  return ok()
}

/**
 * S3 CopyObject — copy source (bucket, key) to a destination key. In
 * content-addressed storage this is a cheap remap: the destination mapping
 * points at the source's cid, with no data transfer. This is what makes rclone
 * server-side copy and move work (rclone implements Move as Copy + Remove).
 *
 * mtime: with the default COPY metadata directive the destination inherits the
 * source mtime; when the client sends an x-amz-meta-mtime (metadata REPLACE, as
 * rclone's SetModTime does by copying an object onto itself) that value wins.
 */
const copyObject = async (
  params: CopyObjectParams,
): Promise<Result<CopyObjectResult, ObjectNotFoundError>> => {
  const source = await s3ObjectMappingsRepository.findByKey(
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

  const mtime = params.Mtime !== undefined ? params.Mtime : source.mtime

  const mapping = await s3ObjectMappingsRepository.createMapping(
    params.Bucket,
    params.Key,
    source.cid,
    source.md5,
    mtime,
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
  return UploadsUseCases.abortUpload(user, uploadId)
}

const listBuckets = async (): Promise<S3BucketInfo[]> => {
  return s3ObjectMappingsRepository.listBuckets()
}

const objectExists = async (bucket: string, key: string): Promise<boolean> => {
  const mapping = await s3ObjectMappingsRepository.findByKey(bucket, key)
  if (!mapping) {
    return false
  }

  // The mapping row persists after an owner removes an object (moved to Trash),
  // but GET and ListObjects treat such objects as not found via isObjectDeleted
  // / notRemovedByOwnerSQL. Mirror that here so object-lock endpoints
  // (GetObjectRetention / GetObjectLegalHold) don't leak retention or
  // legal-hold metadata for keys that are otherwise reported as not found.
  return !(await ObjectUseCases.isObjectDeleted(mapping.cid))
}

export const S3UseCases = {
  getObject,
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
}
