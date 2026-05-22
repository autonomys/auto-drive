import { s3ObjectMappingsRepository } from '../../infrastructure/repositories/index.js'
import { DownloadUseCase } from '../downloads/index.js'
import { err, ok, Result } from 'neverthrow'
import { ObjectNotFoundError } from '../../errors/index.js'
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

// Local extensions to the shared DTOs — kept in the backend rather than
// the shared package so the package doesn't carry Autonomys-specific fields.

/** PutObject result extended with the Autonomys CID for the x-amz-meta-cid header. */
type PutObjectResult = PutObjectCommandResult & { Cid: string }

/** CompleteMultipartUpload result extended with the Autonomys CID. */
type CompleteMultipartUploadResult = CompleteMultipartUploadCommandResult & {
  Cid: string
}

/** CompleteMultipartUpload params extended with the per-part ETags needed to
 *  compute the composite S3 multipart ETag. */
type CompleteMultipartUploadParams = CompleteMultipartUploadCommandParams & {
  Parts?: Array<{ PartNumber: number; ETag: string }>
}
import { UploadsUseCases } from '../uploads/uploads.js'
import { UserWithOrganization } from '@auto-drive/models'
import { handleInternalError } from '../../shared/utils/neverthrow.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import {
  S3BucketInfo,
  S3ObjectListing,
} from '../../infrastructure/repositories/s3/objectMappings.js'
import { createHash } from 'crypto'

const logger = createLogger('useCases:s3')

/** Compute a quoted MD5 ETag in standard AWS S3 format: `"<hex>"`. */
const md5Hex = (data: Buffer): string =>
  createHash('md5').update(data).digest('hex')

/**
 * Compute the S3 composite ETag for a multipart upload.
 *
 * AWS format: MD5 of the binary concatenation of each part's raw MD5 bytes,
 * followed by a hyphen and the part count. e.g. `"abc123...-3"`.
 *
 * Part ETags are expected in quoted hex format: `"d41d8cd98f00b204e9800998ecf8427e"`.
 */
const multipartETag = (partETags: string[]): string => {
  const partMd5Buffers = partETags.map((tag) =>
    Buffer.from(tag.replace(/"/g, ''), 'hex'),
  )
  const composite = md5Hex(Buffer.concat(partMd5Buffers))
  return `"${composite}-${partETags.length}"`
}

/** Format a raw hex MD5 as a quoted S3 ETag: `"<hex>"`. */
const formatETag = (hex: string): string => `"${hex}"`

// ── ListObjectsV2 ──────────────────────────────────────────────────────────

export interface ListObjectsParams {
  bucket: string
  /** Key prefix to filter results (default: empty string = all keys). */
  prefix: string
  /** If set, fold keys at this character into CommonPrefixes (rclone uses '/'). */
  delimiter: string | null
  /** Maximum number of logical entries (objects + common prefixes) to return. */
  maxKeys: number
  /** Opaque token returned by a previous truncated response. */
  continuationToken: string | null
}

export interface ListObjectsResult {
  name: string
  prefix: string
  maxKeys: number
  isTruncated: boolean
  nextContinuationToken: string | null
  objects: S3ObjectListing[]
  commonPrefixes: string[]
}

/**
 * Apply delimiter folding and maxKeys pagination to a sorted list of all
 * matching objects fetched from the DB.
 *
 * Keys that contain `delimiter` after the prefix are folded into
 * CommonPrefixes entries.  Pagination tracks the last raw DB key scanned so
 * that the continuation token restores the exact position on the next call.
 *
 * When maxKeys entries are accumulated and the next entry would be a new
 * CommonPrefix, we stop before adding it.  The continuation token is set to
 * the last key already scanned, which falls before the new prefix group, so
 * the next page re-processes that group from the beginning.
 */
export const buildListResult = (
  sortedObjects: S3ObjectListing[],
  prefix: string,
  delimiter: string | null,
  maxKeys: number,
): Pick<
  ListObjectsResult,
  'objects' | 'commonPrefixes' | 'isTruncated' | 'nextContinuationToken'
> => {
  const objects: S3ObjectListing[] = []
  const commonPrefixSet = new Set<string>()
  let scanIdx = 0

  while (scanIdx < sortedObjects.length) {
    const { key } = sortedObjects[scanIdx]

    // Check whether this key folds into a common prefix.
    let foldedPrefix: string | null = null
    if (delimiter) {
      const afterPrefix = key.slice(prefix.length)
      const delimIdx = afterPrefix.indexOf(delimiter)
      if (delimIdx >= 0) {
        foldedPrefix = prefix + afterPrefix.slice(0, delimIdx + 1)
      }
    }

    if (foldedPrefix !== null) {
      if (!commonPrefixSet.has(foldedPrefix)) {
        // Adding a new common prefix — check if we're already full.
        if (objects.length + commonPrefixSet.size >= maxKeys) {
          // Stop here; the continuation token will fall before this prefix
          // group so the next page re-processes it from the start.
          break
        }
        commonPrefixSet.add(foldedPrefix)
      }
      scanIdx++
      continue
    }

    // Regular object — check capacity before adding.
    if (objects.length + commonPrefixSet.size >= maxKeys) {
      break
    }
    objects.push(sortedObjects[scanIdx])
    scanIdx++
  }

  const isTruncated = scanIdx < sortedObjects.length
  const nextContinuationToken = isTruncated
    ? sortedObjects[scanIdx - 1].key
    : null

  return {
    objects,
    commonPrefixes: [...commonPrefixSet].sort(),
    isTruncated,
    nextContinuationToken,
  }
}

const listObjects = async (
  params: ListObjectsParams,
): Promise<ListObjectsResult> => {
  const { bucket, prefix, delimiter, maxKeys, continuationToken } = params

  // Without a delimiter every DB row is a distinct logical entry, so we only
  // need maxKeys + 1 rows (the extra row lets buildListResult detect
  // truncation without fetching the entire table).  With a delimiter, multiple
  // rows can fold into a single CommonPrefix, so we over-fetch by a factor of
  // 10 to handle large prefix groups while still keeping memory use bounded.
  const dbLimit = delimiter
    ? Math.min(maxKeys * 10 + 100, 10_000)
    : maxKeys + 1

  const allMatching = await s3ObjectMappingsRepository.listObjects(
    bucket,
    prefix,
    continuationToken,
    dbLimit,
  )

  const listResult = buildListResult(allMatching, prefix, delimiter, maxKeys)
  const { objects, commonPrefixes } = listResult
  let { isTruncated, nextContinuationToken } = listResult

  // If the DB returned a full batch (allMatching.length === dbLimit) there may
  // be rows beyond the LIMIT that buildListResult never saw.  This happens when
  // every fetched row folds into CommonPrefixes and none break the maxKeys cap —
  // buildListResult then sees scanIdx === sortedObjects.length and concludes
  // isTruncated = false.  Override to be conservative: one extra empty page is
  // harmless, but silently dropping data is not.
  if (!isTruncated && allMatching.length === dbLimit) {
    isTruncated = true
    nextContinuationToken = allMatching[allMatching.length - 1].key
  }

  return {
    name: bucket,
    prefix,
    maxKeys,
    isTruncated,
    nextContinuationToken,
    objects,
    commonPrefixes,
  }
}

// Extended result type for internal use — includes the CID so the HTTP layer
// can set the x-amz-meta-cid header without an extra DB lookup.
type GetObjectUseCaseResult = GetObjectCommandResult & {
  cid: string
  /** null for objects uploaded before MD5 ETag support was introduced. */
  etag: string | null
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
    Location: objectDownloadPath(params.Bucket, params.Key),
    Bucket: params.Bucket,
    Key: params.Key,
    ETag: etag,
    Cid: cid,
  })
}

const putObject = async (
  user: UserWithOrganization,
  params: PutObjectCommandParams,
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

const listBuckets = async (): Promise<S3BucketInfo[]> => {
  return s3ObjectMappingsRepository.listBuckets()
}

const objectDownloadPath = (bucket: string, key: string) => {
  return `/s3/${bucket}/${key}`
}

export const S3UseCases = {
  getObject,
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  putObject,
  listBuckets,
  listObjects,
}
