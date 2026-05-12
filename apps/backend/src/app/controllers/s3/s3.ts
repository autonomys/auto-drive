import { S3UseCases } from '../../../core/s3/index.js'
import { handleError } from '../../../errors/index.js'
import { handleS3Auth } from '../../../infrastructure/services/auth/s3.js'
import {
  getByteRange,
  handleDownloadResponseHeaders,
  handleS3DownloadResponseHeaders,
} from '@autonomys/file-server'
import { pipeline } from 'stream'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import { Request, Response } from 'express'
import { sendXML } from './utils.js'
import { UploadOptions } from '@auto-drive/models'
import {
  CompressionAlgorithm,
  EncryptionAlgorithm,
} from '@autonomys/auto-dag-data'

const logger = createLogger('s3:controllers')

/**
 * Parse the bucket name and object key from a raw S3 request path.
 *
 * The first path segment is the bucket name; everything after the first '/'
 * is the key. Keys with no '/' are assigned to the 'default' bucket so that
 * objects uploaded before bucket support was introduced remain accessible.
 *
 * Examples:
 *   'my-archive/file.txt'     → { bucket: 'my-archive', key: 'file.txt' }
 *   'my-archive/sub/file.txt' → { bucket: 'my-archive', key: 'sub/file.txt' }
 *   'file.txt'                → { bucket: 'default',    key: 'file.txt' }
 */
const parseBucketAndKey = (rawKey: string): { bucket: string; key: string } => {
  const slashIndex = rawKey.indexOf('/')
  if (slashIndex === -1) {
    return { bucket: 'default', key: rawKey }
  }
  return {
    bucket: rawKey.slice(0, slashIndex),
    key: rawKey.slice(slashIndex + 1),
  }
}

const getUploadOptions = (req: Request) => {
  const {
    'x-amz-meta-compression': compressionAlgorithm,
    'x-amz-meta-encryption': encryptionAlgorithm,
  } = req.headers

  const UploadOptions: UploadOptions = {
    compression: compressionAlgorithm
      ? { algorithm: compressionAlgorithm as CompressionAlgorithm }
      : undefined,
    encryption: encryptionAlgorithm
      ? { algorithm: encryptionAlgorithm as EncryptionAlgorithm }
      : undefined,
  }

  return UploadOptions
}

export const listBucketsHandler = async (_req: Request, res: Response) => {
  const buckets = await S3UseCases.listBuckets()
  sendXML(res, 'ListAllMyBucketsResult', {
    Buckets: {
      Bucket: buckets.map((b) => ({
        Name: b.name,
        CreationDate: b.creationDate.toISOString(),
      })),
    },
  })
}

export const getObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)
  const byteRange = getByteRange(req)
  const downloadResult = await S3UseCases.getObject({
    Key: key,
    Range: byteRange,
    Bucket: bucket,
  })

  if (downloadResult.isErr()) {
    handleError(downloadResult.error, res)
    return
  }
  const {
    metadata,
    startDownload,
    byteRange: resultingByteRange,
  } = downloadResult.value

  handleDownloadResponseHeaders(req, res, metadata, {
    byteRange: resultingByteRange,
  })
  handleS3DownloadResponseHeaders(req, res, metadata)

  pipeline(await startDownload(), res, (err: Error | null) => {
    if (err) {
      if (res.headersSent) return
      logger.error('Error streaming data', err)
      res.status(500).json({
        error: 'Failed to stream data',
        details: err.message,
      })
    }
  })
}

export const headObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)
  const byteRange = getByteRange(req)
  const downloadResult = await S3UseCases.getObject({
    Key: key,
    Range: byteRange,
    Bucket: bucket,
  })

  if (downloadResult.isErr()) {
    handleError(downloadResult.error, res)
    return
  }
  const { metadata, byteRange: resultingByteRange } = downloadResult.value

  handleDownloadResponseHeaders(req, res, metadata, {
    byteRange: resultingByteRange,
  })
  handleS3DownloadResponseHeaders(req, res, metadata)

  res.sendStatus(204)
}

export const createMultipartUploadHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const uploadOptions = getUploadOptions(req)
  const { bucket, key } = parseBucketAndKey(req.params.key)

  const result = await S3UseCases.createMultipartUpload(user, {
    Bucket: bucket,
    Key: key,
    ContentType: req.headers['content-type'],
    UploadOptions: uploadOptions,
  })

  if (result.isErr()) {
    handleError(result.error, res)
    return
  }

  sendXML(res, 'CreateMultipartUploadResult', result.value)
}

export const uploadPartHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)
  const { uploadId, partNumber } = req.query

  // Validate required parameters
  if (!uploadId || !partNumber) {
    logger.error(
      'Missing required parameters: uploadId=%s, partNumber=%s',
      uploadId,
      partNumber,
    )
    return handleError(
      new Error('Missing required parameters: uploadId and partNumber'),
      res,
    )
  }

  const parsedPartNumber = parseInt(partNumber as string)
  if (isNaN(parsedPartNumber)) {
    logger.error('Invalid partNumber: %s', partNumber)
    return handleError(new Error('Invalid partNumber'), res)
  }

  logger.info('Uploading part %s of %s', parsedPartNumber, uploadId)

  const result = await S3UseCases.uploadPart(user, {
    Bucket: bucket,
    Key: key,
    UploadId: uploadId as string,
    PartNumber: parsedPartNumber,
    Body: req.body,
  })

  if (result.isErr()) {
    handleError(result.error, res)
    return
  }

  sendXML(res, 'UploadPartResult', result.value)
}

export const completeMultipartUploadHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)
  const result = await S3UseCases.completeMultipartUpload(user, {
    Bucket: bucket,
    Key: key,
    UploadId: req.query.uploadId as string,
  })

  if (result.isErr()) {
    handleError(result.error, res)
    return
  }

  sendXML(res, 'CompleteMultipartUploadResult', result.value)
}

export const deleteObjectHandler = async (_req: Request, res: Response) => {
  sendXML(res.status(403), 'Error', {
    Code: 'AccessDenied',
    Message:
      'Auto Drive storage is immutable. Objects cannot be deleted from the Autonomys DSN.',
  })
}

export const putObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const uploadOptions = getUploadOptions(req)
  const { bucket, key } = parseBucketAndKey(req.params.key)

  const result = await S3UseCases.putObject(user, {
    Bucket: bucket,
    Key: key,
    Body: req.body,
    ContentType: req.headers['content-type'],
    UploadOptions: uploadOptions,
  })

  if (result.isErr()) {
    handleError(result.error, res)
    return
  }

  sendXML(res, 'PutObjectResult', result.value)
}

export const deleteObjectHandler = async (_req: Request, res: Response) => {
  sendXML(res.status(403), 'Error', {
    Code: 'AccessDenied',
    Message:
      'Auto Drive storage is immutable. Objects cannot be deleted from the Autonomys DSN.',
  })
}
