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
import js2xmlparser from 'js2xmlparser'
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
      // AWS SDK v3 XML-encodes the double-quotes around the ETag hex digest
      // as &quot; (e.g. &quot;d41d…&quot;).  Decode before storing so that
      // multipartETag can strip the quotes and read the raw hex correctly.
      const etag = etagMatch[1].trim().replace(/&quot;/g, '"')
      parts.push({
        PartNumber: parseInt(partNumberMatch[1], 10),
        ETag: etag,
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
    lastModified,
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
  res.set('Last-Modified', lastModified.toUTCString())

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
    lastModified,
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
  res.set('Last-Modified', lastModified.toUTCString())

  // 200, not 204: HeadObject returns the headers GET would send (Content-Length,
  // Content-Type, …) with an empty body. A 204 is defined as bodiless, so Node
  // strips those content headers.
  res.status(200).end()
}

// ── Object Lock ───────────────────────────────────────────────────────────
// Auto Drive storage is immutable (WORM) by construction, so we expose a fixed
// COMPLIANCE-mode lock contract with a far-future retention. The contract is
// intrinsic and cannot be configured by clients, so the PutObjectLock* / Put*
// Retention / Put*LegalHold counterparts stay 501 (wired in http.ts).

// "Forever" sentinel for RetainUntilDate. S3 has no infinity value, so use the
// max representable date: year 9999 is the ceiling for SQL DATETIME and Python
// datetime.max, so anything larger would overflow common clients (e.g. boto3).
const OBJECT_LOCK_RETAIN_UNTIL = '9999-12-31T23:59:59Z'

export const objectLockConfigurationBody = () => ({
  ObjectLockEnabled: 'Enabled',
  Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: 100 } },
})

export const objectRetentionBody = () => ({
  Mode: 'COMPLIANCE',
  RetainUntilDate: OBJECT_LOCK_RETAIN_UNTIL,
})

export const objectLegalHoldBody = () => ({ Status: 'ON' })

export const getObjectLockConfigurationHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return
  sendXML(res, 'ObjectLockConfiguration', objectLockConfigurationBody())
}

// The retention and legal-hold contracts are object-level, so reject a key
// that doesn't exist with NoSuchKey rather than asserting a lock over nothing.
const sendNoSuchKey = (res: Response, key: string) => {
  sendXML(res.status(404), 'Error', {
    Code: 'NoSuchKey',
    Message: 'The specified key does not exist.',
    Key: key,
  })
}

export const getObjectRetentionHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return
  const { bucket, key } = parseBucketAndKey(req.params.key)
  if (!(await S3UseCases.objectExists(bucket, key))) {
    sendNoSuchKey(res, key)
    return
  }
  sendXML(res, 'Retention', objectRetentionBody())
}

export const getObjectLegalHoldHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return
  const { bucket, key } = parseBucketAndKey(req.params.key)
  if (!(await S3UseCases.objectExists(bucket, key))) {
    sendNoSuchKey(res, key)
    return
  }
  sendXML(res, 'LegalHold', objectLegalHoldBody())
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

  // Set ETag and CID headers explicitly and use res.end() rather than sendXML
  // (which calls res.send()). res.send() triggers Express's auto-ETag generation
  // which would overwrite our composite MD5 ETag with a body-derived hash.
  const { Cid: completeCid, ETag: completeETag, ...completeXmlBody } = result.value
  res.set('ETag', completeETag)
  res.set('x-amz-meta-cid', completeCid)
  res.setHeader('Content-Type', 'application/xml')
  res.end(
    js2xmlparser.parse('CompleteMultipartUploadResult', {
      ETag: completeETag,
      ...completeXmlBody,
    }),
  )
}

export const listObjectsV2Handler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  // For ListObjectsV2, req.params.key is purely a bucket name.  The AWS SDK
  // appends a trailing slash when using bucketEndpoint:true, so we get either
  // "my-bucket/" or "my-bucket" — take everything before the first '/'.
  const bucket = req.params.key.split('/')[0]

  const prefix = (req.query.prefix as string) ?? ''
  const delimiter = (req.query.delimiter as string) ?? null
  const rawMaxKeys = parseInt((req.query['max-keys'] as string) ?? '1000', 10)
  const maxKeys = Math.min(Math.max(rawMaxKeys > 0 ? rawMaxKeys : 1000, 1), 1000)
  const continuationToken =
    (req.query['continuation-token'] as string) ?? null

  const result = await S3UseCases.listObjects({
    bucket,
    prefix,
    delimiter,
    maxKeys,
    continuationToken,
  })

  // Build the XML body.  js2xmlparser repeats a key for each array element,
  // which is exactly the S3 format (multiple <Contents> / <CommonPrefixes>
  // siblings at the root level).
  const xmlBody: Record<string, unknown> = {
    Name: result.name,
    Prefix: result.prefix,
    MaxKeys: result.maxKeys,
    KeyCount: result.objects.length + result.commonPrefixes.length,
    IsTruncated: result.isTruncated,
  }

  if (result.nextContinuationToken) {
    xmlBody.NextContinuationToken = result.nextContinuationToken
  }

  if (result.objects.length > 0) {
    xmlBody.Contents = result.objects.map((obj) => ({
      Key: obj.key,
      Size: obj.size.toString(),
      LastModified: obj.lastModified.toISOString(),
      // Return the stored MD5 so clients (rclone, AWS CLI) can verify
      // checksums from the listing, matching HeadObject. Legacy objects with
      // no stored md5 fall back to the CID, which remains in x-amz-meta-cid.
      ETag: obj.md5 ? `"${obj.md5}"` : `"${obj.cid}"`,
    }))
  }

  if (result.commonPrefixes.length > 0) {
    xmlBody.CommonPrefixes = result.commonPrefixes.map((p) => ({
      Prefix: p,
    }))
  }

  sendXML(res, 'ListBucketResult', xmlBody)
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

export const notImplementedHandler = async (_req: Request, res: Response) => {
  sendXML(res.status(501), 'Error', {
    Code: 'NotImplemented',
    Message: 'This S3 operation is not supported by Auto Drive.',
  })
}
