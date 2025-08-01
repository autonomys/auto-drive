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
import { UploadsUseCases } from '../uploads/uploads.js'
import { UserWithOrganization } from '@auto-drive/models'
import { v4 } from 'uuid'
import { handleInternalError } from '../../shared/utils/neverthrow.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('useCases:s3')

const getObject = async (
  params: GetObjectCommandParams,
): Promise<Result<GetObjectCommandResult, ObjectNotFoundError>> => {
  const mapping = await s3ObjectMappingsRepository.findByKey(params.Key)
  if (!mapping) {
    return err(new ObjectNotFoundError(`Object ${params.Key} not found`))
  }

  return await DownloadUseCase.downloadObjectByAnonymous(mapping.cid, {
    byteRange: params.Range,
  })
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
    // TODO: add upload options
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
  // to-comment: AWS uses 1-indexed part numbers, but we use 0-indexed part numbers
  const zeroIndexedPartNumber = params.PartNumber - 1

  // To-do: support not sorted part uploads
  await UploadsUseCases.uploadChunk(
    user,
    params.UploadId,
    zeroIndexedPartNumber,
    params.Body,
  )

  return ok({
    ETag: v4(),
  })
}

const completeMultipartUpload = async (
  user: UserWithOrganization,
  params: CompleteMultipartUploadCommandParams,
): Promise<
  Result<CompleteMultipartUploadCommandResult, ObjectNotFoundError>
> => {
  const cid = await UploadsUseCases.completeUpload(user, params.UploadId)

  const mapping = await s3ObjectMappingsRepository.createMapping(
    params.Key,
    cid,
  )
  logger.debug('Created mapping: key=(%s) -> cid=(%s)', mapping, cid)

  return ok({
    Location: objectDownloadPath(params.Key),
    Bucket: params.Bucket,
    Key: params.Key,
    ETag: cid,
  })
}

const putObject = async (
  user: UserWithOrganization,
  params: PutObjectCommandParams,
): Promise<Result<PutObjectCommandResult, ObjectNotFoundError>> => {
  const name = params.Key.split('/').pop()!

  const upload = await UploadsUseCases.createFileUpload(
    user,
    name,
    params.ContentType ?? null,
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
    params.Key,
    cid,
  )
  logger.debug('Created mapping: key=(%s) -> cid=(%s)', mapping, cid)

  return ok({ ETag: cid })
}

const objectDownloadPath = (key: string) => {
  return `/s3/${key}`
}

export const S3UseCases = {
  getObject,
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  putObject,
}
