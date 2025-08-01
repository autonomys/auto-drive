import { S3UseCases } from '../../../core/s3/index.js'
import { handleError } from '../../../errors/index.js'
import { handleS3Auth } from '../../../infrastructure/services/auth/s3.js'
import { getByteRange } from '../../../shared/utils/http.js'
import { handleDownloadResponseHeaders } from '../../../shared/httpHandlers/download.js'
import { pipeline } from 'stream'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import { Request, Response } from 'express'
import { sendXML } from './utils.js'

const Bucket = 'default'

const logger = createLogger('s3:controllers')

export const getObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { key } = req.params
  const byteRange = getByteRange(req)
  const downloadResult = await S3UseCases.getObject({
    Key: key,
    Range: byteRange,
    Bucket,
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

  handleDownloadResponseHeaders(req, res, metadata, resultingByteRange)

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

export const createMultipartUploadHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { key } = req.params
  const downloadResult = await S3UseCases.createMultipartUpload(user, {
    Bucket,
    Key: key,
    ContentType: req.headers['content-type'],
  })

  if (downloadResult.isErr()) {
    handleError(downloadResult.error, res)
    return
  }

  sendXML(res, 'CreateMultipartUploadResult', downloadResult.value)
}

export const uploadPartHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { key } = req.params
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

  const downloadResult = await S3UseCases.uploadPart(user, {
    Bucket,
    Key: key,
    UploadId: uploadId as string,
    PartNumber: parsedPartNumber,
    Body: req.body,
  })

  if (downloadResult.isErr()) {
    handleError(downloadResult.error, res)
    return
  }

  sendXML(res, 'UploadPartResult', downloadResult.value)
}

export const completeMultipartUploadHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { key } = req.params
  const downloadResult = await S3UseCases.completeMultipartUpload(user, {
    Bucket,
    Key: key,
    UploadId: req.query.uploadId as string,
  })

  if (downloadResult.isErr()) {
    handleError(downloadResult.error, res)
    return
  }

  sendXML(res, 'CompleteMultipartUploadResult', downloadResult.value)
}

export const putObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { key } = req.params
  const downloadResult = await S3UseCases.putObject(user, {
    Bucket,
    Key: key,
    Body: req.body,
    ContentType: req.headers['content-type'],
  })

  if (downloadResult.isErr()) {
    handleError(downloadResult.error, res)
    return
  }

  sendXML(res, 'PutObjectResult', downloadResult.value)
}
