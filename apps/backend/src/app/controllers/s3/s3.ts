import { S3UseCases } from '../../../core/s3/index.js'
import { handleError, ForbiddenError } from '../../../errors/index.js'
import { handleS3Auth } from '../../../infrastructure/services/auth/s3.js'
import {
  getByteRange,
  handleDownloadResponseHeaders,
  handleS3DownloadResponseHeaders,
} from '@autonomys/file-server'
import { pipeline } from 'stream'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import { Request, Response } from 'express'
import { encodeS3Key, planListingEncoding, sendXML } from './utils.js'
import js2xmlparser from 'js2xmlparser'
import { XMLParser } from 'fast-xml-parser'
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
 *
 * A bare, slash-less path therefore has no dedicated bucket-operation meaning —
 * it is always an object in the 'default' bucket. Bucket-level endpoints
 * (CreateBucket / DeleteBucket / HeadBucket) are intentionally unimplemented for
 * this reason; see the decision note in http.ts. S3 clients must set
 * `no_check_bucket = true` so they never emit those calls.
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
 * The modification time a client associates with an object, sent as the
 * x-amz-meta-mtime header (rclone uses a float unix-seconds string). Stored and
 * echoed back verbatim so the value round-trips with full precision.
 */
const getMtime = (req: Request): string | null => {
  const mtime = req.headers['x-amz-meta-mtime']
  return typeof mtime === 'string' ? mtime : null
}

/**
 * Parse the source object of a CopyObject request from its x-amz-copy-source
 * header. The value is "/{bucket}/{key}" (the leading slash is optional), with
 * each path segment URL-encoded and an optional "?versionId=..." suffix — Auto
 * Drive has no object versioning, so any versionId is dropped. Returns null when
 * the header is missing or malformed.
 */
const parseCopySource = (
  req: Request,
): { bucket: string; key: string } | null => {
  const raw = req.headers['x-amz-copy-source']
  if (typeof raw !== 'string' || raw.length === 0) return null

  // Drop any ?versionId= suffix, strip a leading slash, then URL-decode.
  const withoutVersion = raw.split('?')[0].replace(/^\//, '')
  let decoded: string
  try {
    decoded = decodeURIComponent(withoutVersion)
  } catch {
    // Malformed percent-encoding — treat as no valid source.
    return null
  }
  if (decoded.length === 0) return null

  return parseBucketAndKey(decoded)
}

/**
 * Build the absolute, host-aware object URL for the CompleteMultipartUpload
 * `Location` response field — per the S3 spec, the URL of the newly created
 * object as seen from the endpoint the client used.
 *
 * The backend mounts the S3 API at `/s3`, but the public-facing endpoint
 * differs per vhost (the dedicated `s3.` subdomain serves it at the root; the
 * legacy host serves it under `/s3`) and nginx rewrites both onto `/s3` before
 * the request reaches here. So the URL is reconstructed from the forwarding
 * headers nginx sets rather than from the request's own (rewritten) path:
 *   - X-Forwarded-Proto — scheme at the edge (nginx terminates TLS and proxies
 *     over http, so req.protocol alone would always read 'http').
 *   - Host — the public hostname (forwarded via `proxy_set_header Host`).
 *   - X-Forwarded-Prefix — the public path prefix the S3 API is exposed under:
 *     '/s3' on the legacy host, root on the subdomain. nginx drops
 *     empty-valued headers, so the subdomain sends '/', normalized here to ''.
 * With no forwarding headers (requests straight to Express, e.g. tests), this
 * falls back to req.protocol, the Host header, and the '/s3' mount.
 */
const buildObjectLocation = (
  req: Request,
  bucket: string,
  key: string,
): string => {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol
  const host = req.headers.host ?? ''
  const rawPrefix = (req.headers['x-forwarded-prefix'] as string) ?? '/s3'
  const prefix = rawPrefix === '/' ? '' : rawPrefix.replace(/\/+$/, '')
  return `${proto}://${host}${prefix}/${bucket}/${key}`
}

/** Thrown when a CompleteMultipartUpload body is not valid per the S3 spec. */
export class MalformedMultipartError extends Error {}

// processEntities (on by default) decodes the &#34; that aws-sdk-go-v2 (rclone)
// uses for the ETag quotes — the crux of the fix; boto3 emits literal quotes
// and both land on `"<hex>"`. removeNSPrefix handles <s3:Part>; parseTagValue
// off keeps ETags as strings.
const multipartXmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
})

// Extract the part list from a CompleteMultipartUpload body. A real parser
// (not a regex) so namespaces, ordering, and entity encoding work across
// clients. Each <Part> needs an integer PartNumber (>= 1) and a non-empty
// ETag, else throws MalformedMultipartError so the caller can return 400
// MalformedXML. Returns parts sorted by PartNumber.
export const parseMultipartParts = (
  body: Buffer,
): Array<{ PartNumber: number; ETag: string }> => {
  let parsed: unknown
  try {
    parsed = multipartXmlParser.parse(body.toString('utf-8'))
  } catch {
    throw new MalformedMultipartError('Malformed CompleteMultipartUpload XML')
  }

  const root = (parsed as Record<string, unknown> | undefined)
    ?.CompleteMultipartUpload as Record<string, unknown> | undefined
  if (root == null || typeof root !== 'object') {
    throw new MalformedMultipartError(
      'Missing CompleteMultipartUpload root element',
    )
  }

  // <Part> is a single object for one part and an array for many.
  const rawPart = root.Part
  const rawParts =
    rawPart == null ? [] : Array.isArray(rawPart) ? rawPart : [rawPart]
  if (rawParts.length === 0) {
    throw new MalformedMultipartError('CompleteMultipartUpload has no parts')
  }

  const parts = rawParts.map((part) => {
    const record = part as Record<string, unknown>
    const partNumber = Number(record?.PartNumber)
    const etag = record?.ETag
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      throw new MalformedMultipartError('Part is missing a valid PartNumber')
    }
    if (typeof etag !== 'string' || etag.trim() === '') {
      throw new MalformedMultipartError('Part is missing a non-empty ETag')
    }
    return { PartNumber: partNumber, ETag: etag.trim() }
  })

  return parts.sort((a, b) => a.PartNumber - b.PartNumber)
}

export const listBucketsHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const buckets = await S3UseCases.listBuckets(user)
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
  const downloadResult = await S3UseCases.getObject(user, {
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
    mtime,
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
  // Echo the client mtime so tools (e.g. rclone) read back what they wrote.
  if (mtime) res.set('x-amz-meta-mtime', mtime)

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
  const downloadResult = await S3UseCases.getObject(user, {
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
    mtime,
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
  // Echo the client mtime so tools (e.g. rclone) read back what they wrote.
  if (mtime) res.set('x-amz-meta-mtime', mtime)

  // 200, not 204: HeadObject returns the headers GET would send (Content-Length,
  // Content-Type, …) with an empty body. A 204 is defined as bodiless, so Node
  // strips those content headers.
  res.status(200).end()
}

// ── Object Lock ───────────────────────────────────────────────────────────
// Object Lock is NOT enforced. The S3 namespace is mutable — DeleteObject
// (soft-delete), overwrite, and rename all succeed — so advertising a
// COMPLIANCE/WORM lock would be a false promise a client could rely on. (The
// underlying DSN data is permanent, but that is a storage property, not an S3
// object-lock guarantee.) These read endpoints therefore report "no Object Lock
// configured", exactly as a bucket/object without Object Lock does. The
// PutObjectLock* / Put*Retention / Put*LegalHold counterparts stay 501.

/** Legal hold is never on (Object Lock is not enforced). */
export const objectLegalHoldBody = () => ({ Status: 'OFF' })

export const getObjectLockConfigurationHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return
  // No bucket-level Object Lock configuration exists.
  sendXML(res.status(404), 'Error', {
    Code: 'ObjectLockConfigurationNotFoundError',
    Message: 'Object Lock configuration does not exist for this bucket',
  })
}

// Reject a key that doesn't exist with NoSuchKey rather than reporting lock
// state for a nonexistent object.
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
  if (!(await S3UseCases.objectExists(user, bucket, key))) {
    sendNoSuchKey(res, key)
    return
  }
  // The object exists but carries no retention (Object Lock is not enforced).
  sendXML(res.status(404), 'Error', {
    Code: 'NoSuchObjectLockConfiguration',
    Message: 'The specified object does not have a Retention configuration',
  })
}

export const getObjectLegalHoldHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return
  const { bucket, key } = parseBucketAndKey(req.params.key)
  if (!(await S3UseCases.objectExists(user, bucket, key))) {
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
    Mtime: getMtime(req),
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
  // A body that can't be parsed into valid parts is a client error, not a
  // reason to silently store a wrong ETag — reject it with 400 MalformedXML.
  let parts: Array<{ PartNumber: number; ETag: string }>
  try {
    parts = parseMultipartParts(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))
  } catch (error) {
    if (error instanceof MalformedMultipartError) {
      sendXML(res.status(400), 'Error', {
        Code: 'MalformedXML',
        Message: error.message,
      })
      return
    }
    throw error
  }

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
  // Location is built here (not in the use case) because it depends on the
  // public endpoint the request arrived on — see buildObjectLocation.
  const Location = buildObjectLocation(req, bucket, key)
  res.set('ETag', completeETag)
  res.set('x-amz-meta-cid', completeCid)
  res.setHeader('Content-Type', 'application/xml')
  res.end(
    js2xmlparser.parse('CompleteMultipartUploadResult', {
      ETag: completeETag,
      Location,
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
  const encodingType = (req.query['encoding-type'] as string) ?? null

  const result = await S3UseCases.listObjects(user, {
    bucket,
    prefix,
    delimiter,
    maxKeys,
    continuationToken,
  })

  // Keys may contain characters XML cannot represent; encoding-type=url is the
  // S3 mechanism for returning them. Without opt-in, reject with 400 rather
  // than throwing a 500 in the serializer.
  const plan = planListingEncoding(
    [...result.objects.map((o) => o.key), ...result.commonPrefixes],
    encodingType,
  )

  if (plan === 'reject') {
    sendXML(res.status(400), 'Error', {
      Code: 'InvalidArgument',
      Message:
        'This listing contains keys with characters that require URL encoding. Retry the request with encoding-type=url.',
      ArgumentName: 'encoding-type',
      Resource: `/${bucket}/`,
    })
    return
  }

  const encode = plan === 'encode' ? encodeS3Key : (value: string) => value

  // Build the XML body.  js2xmlparser repeats a key for each array element,
  // which is exactly the S3 format (multiple <Contents> / <CommonPrefixes>
  // siblings at the root level).
  const xmlBody: Record<string, unknown> = {
    Name: result.name,
    Prefix: encode(result.prefix),
    MaxKeys: result.maxKeys,
    KeyCount: result.objects.length + result.commonPrefixes.length,
    IsTruncated: result.isTruncated,
  }

  // Echo the encoding back so clients know to url-decode the keys below.
  if (plan === 'encode') {
    xmlBody.EncodingType = 'url'
  }

  if (result.nextContinuationToken) {
    xmlBody.NextContinuationToken = result.nextContinuationToken
  }

  if (result.objects.length > 0) {
    xmlBody.Contents = result.objects.map((obj) => ({
      Key: encode(obj.key),
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
      Prefix: encode(p),
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
    Mtime: getMtime(req),
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

export const deleteObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)

  // Soft-delete: the (bucket, key) mapping is hidden and, if it was the last S3
  // reference to the content, the object is moved to the owner's web-app Trash.
  // The underlying bytes are never removed from the Autonomys DSN.
  await S3UseCases.deleteObject(user, bucket, key)

  // S3 DeleteObject responds 204 No Content with an empty body, whether or not
  // the key existed (delete is idempotent).
  res.status(204).end()
}

export const copyObjectHandler = async (req: Request, res: Response) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const { bucket, key } = parseBucketAndKey(req.params.key)
  const source = parseCopySource(req)
  if (!source) {
    sendXML(res.status(400), 'Error', {
      Code: 'InvalidArgument',
      Message: 'The x-amz-copy-source header is missing or malformed.',
      ArgumentName: 'x-amz-copy-source',
    })
    return
  }

  // Metadata handling follows x-amz-metadata-directive (default COPY):
  //  - COPY:    the destination inherits the source metadata → pass undefined so
  //             the use case keeps the source mtime.
  //  - REPLACE: the destination's metadata is exactly what this request carries,
  //             so use the x-amz-meta-mtime header verbatim — a string to set it,
  //             or null to CLEAR it (REPLACE with no mtime header means no mtime;
  //             rclone's SetModTime always sends REPLACE + mtime, so it still
  //             writes the intended value).
  const directive = req.headers['x-amz-metadata-directive']
  const isReplace =
    typeof directive === 'string' && directive.toUpperCase() === 'REPLACE'
  const mtime = isReplace ? getMtime(req) : undefined

  const result = await S3UseCases.copyObject(user, {
    SourceBucket: source.bucket,
    SourceKey: source.key,
    Bucket: bucket,
    Key: key,
    Mtime: mtime,
  })

  if (result.isErr()) {
    // Source key not found in the caller's namespace → NoSuchKey, per S3.
    sendNoSuchKey(res, source.key)
    return
  }

  const { ETag, Cid, LastModified } = result.value
  res.set('x-amz-meta-cid', Cid)
  res.set('ETag', ETag)
  // The CopyObjectResult body carries ETag + LastModified. rclone re-HEADs the
  // destination afterward, so these are informational, but the XML must be
  // well-formed for the AWS SDK's response parser.
  sendXML(res, 'CopyObjectResult', {
    ETag,
    LastModified: LastModified.toISOString(),
  })
}

export const abortMultipartUploadHandler = async (
  req: Request,
  res: Response,
) => {
  const user = await handleS3Auth(req, res)
  if (!user) return

  const uploadId = req.query.uploadId as string
  if (!uploadId) {
    sendXML(res.status(400), 'Error', {
      Code: 'InvalidArgument',
      Message: 'The uploadId query parameter is required.',
      ArgumentName: 'uploadId',
    })
    return
  }

  const result = await S3UseCases.abortMultipartUpload(user, uploadId)
  if (result.isErr()) {
    if (result.error instanceof ForbiddenError) {
      sendXML(res.status(403), 'Error', {
        Code: 'AccessDenied',
        Message: 'You do not have permission to abort this multipart upload.',
        UploadId: uploadId,
      })
      return
    }
    // Unknown upload id → NoSuchUpload.
    sendXML(res.status(404), 'Error', {
      Code: 'NoSuchUpload',
      Message: 'The specified multipart upload does not exist.',
      UploadId: uploadId,
    })
    return
  }

  // S3 AbortMultipartUpload responds 204 No Content.
  res.status(204).end()
}

export const notImplementedHandler = async (_req: Request, res: Response) => {
  sendXML(res.status(501), 'Error', {
    Code: 'NotImplemented',
    Message: 'This S3 operation is not supported by Auto Drive.',
  })
}
