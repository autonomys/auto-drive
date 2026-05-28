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
