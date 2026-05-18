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

/**
 * Extract part ETags from a CompleteMultipartUpload XML request body.
 *
 * AWS SDK v3 for JavaScript serialises <ETag> BEFORE <PartNumber> inside
 * each <Part> element:
 *
 *   <CompleteMultipartUpload>
 *     <Part><ETag>"md5hex"</ETag><PartNumber>1</PartNumber></Part>
 *     ...
 *   </CompleteMultipartUpload>
 *
 * Other clients (e.g. older SDKs, rclone) may use the opposite order.  To
 * handle both, each <Part> block is extracted first and then the two fields
 * are parsed independently from its content.
 *
 * Returns parts sorted by PartNumber (ascending) so the composite ETag is
 * computed in the correct order.
 */
const parseMultipartParts = (
  body: Buffer,
): Array<{ PartNumber: number; ETag: string }> => {
  const xml = body.toString('utf-8')
  // Extract each <Part>…</Part> block, then parse fields independently so
  // that element order within the block doesn't matter.
  const partBlockRegex = /<Part>([\s\S]*?)<\/Part>/g
  const parts: Array<{ PartNumber: number; ETag: string }> = []
  let block: RegExpExecArray | null
  while ((block = partBlockRegex.exec(xml)) !== null) {
    const content = block[1]
    const partNumberMatch = content.match(/<PartNumber>(\d+)<\/PartNumber>/)
    const etagMatch = content.match(/<ETag>([^<]+)<\/ETag>/)
    if (partNumberMatch && etagMatch) {
      parts.push({
        PartNumber: parseInt(partNumberMatch[1], 10),
        ETag: etagMatch[1].trim(),
      })
    }
  }
  return parts.sort((a, b) => a.PartNumber - b.PartNumber)
}

export const listBucketsHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

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
    cid,
    etag,
  } = downloadResult.value

  handleDownloadResponseHeaders(req, res, metadata, {
    byteRange: resultingByteRange,
  })
  handleS3DownloadResponseHeaders(req, res, metadata)

  // ETag: set to the MD5 for objects uploaded after this feature was introduced.
  // Legacy objects (md5 = null in the DB) do not get an ETag header — the CID
  // is always available in x-amz-meta-cid for Autonomys-aware clients.
  if (etag) res.set('ETag', etag)
  // Always expose the CID so clients that understand Autonomys can use it.
  res.set('x-amz-meta-cid', cid)

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
  const {
    metadata,
    byteRange: resultingByteRange,
    cid,
    etag,
  } = downloadResult.value

  handleDownloadResponseHeaders(req, res, metadata, {
    byteRange: resultingByteRange,
  })
  handleS3DownloadResponseHeaders(req, res, metadata)

  // ETag: set to the MD5 for objects uploaded after this feature was introduced.
  // Legacy objects (md5 = null in the DB) do not get an ETag header — the CID
  // is always available in x-amz-meta-cid for Autonomys-aware clients.
  if (etag) res.set('ETag', etag)
  // Always expose the CID so clients that understand Autonomys can use it.
  res.set('x-amz-meta-cid', cid)

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

  // The AWS SDK reads the part ETag exclusively from the HTTP ETag header.
  // Respond with the header only — no body — so Express's auto-ETag
  // generation cannot overwrite our MD5 value with a body-derived hash.
  res.set('ETag', result.value.ETag)
  res.status(200).end()
}

export const completeMultipartUploadHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)

  // Parse the part list from the XML request body so we can compute the
  // standard S3 composite ETag (MD5 of concatenated per-part MD5s + part count).
  const parts = Buffer.isBuffer(req.body) ? parseMultipartParts(req.body) : []

  const result = await S3UseCases.completeMultipartUpload(user, {
    Bucket: bucket,
    Key: key,
    UploadId: req.query.uploadId as string,
    Parts: parts,
  })

  if (result.isErr()) {
    handleError(result.error, res)
    return
  }

  // Strip Cid before serialising — it belongs in the header only, not the XML body.
  const { Cid: completeCid, ...completeXmlBody } = result.value
  res.set('x-amz-meta-cid', completeCid)
  sendXML(res, 'CompleteMultipartUploadResult', completeXmlBody)
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

  // Standard S3 PutObject: ETag and custom metadata go in response headers;
  // the body is empty.  The AWS SDK reads ETag exclusively from the header.
  const { ETag, Cid } = result.value
  res.set('ETag', ETag)
  res.set('x-amz-meta-cid', Cid)
  res.status(200).end()
}

export const deleteObjectHandler = async (_req: Request, res: Response) => {
  sendXML(res.status(403), 'Error', {
    Code: 'AccessDenied',
    Message:
      'Auto Drive storage is immutable. Objects cannot be deleted from the Autonomys DSN.',
  })
}
