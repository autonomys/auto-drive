import { raw, Router, Request, Response, NextFunction } from 'express'
import { asyncSafeHandler } from '../../../shared/utils/express.js'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import {
  abortMultipartUploadHandler,
  completeMultipartUploadHandler,
  copyObjectHandler,
  createMultipartUploadHandler,
  deleteObjectHandler,
  deleteObjectVersionHandler,
  getBucketVersioningHandler,
  getObjectHandler,
  getObjectLegalHoldHandler,
  getObjectLockConfigurationHandler,
  getObjectRetentionHandler,
  headObjectHandler,
  listBucketsHandler,
  listObjectsV2Handler,
  listObjectVersionsHandler,
  notImplementedHandler,
  putObjectHandler,
  uploadPartHandler,
  stashContentEncoding,
} from './s3.js'

const s3Controller = Router()

const logger = createLogger('http:controllers:s3')

type S3HandlerConfig = {
  [key: string]: (req: Request, res: Response) => Promise<void>
}

// ── Bucket-level operations are intentionally NOT implemented ────────────────
// A true S3 CreateBucket / DeleteBucket / HeadBucket targets a bare `/{bucket}`
// with no object key (PUT / DELETE / HEAD). This API folds the first path
// segment into the bucket name (see parseBucketAndKey in s3.ts), so a bare,
// slash-less path is indistinguishable from a flat, default-bucket object
// operation — the exact semantics the bucket-support migration and every
// legacy flat key depend on. Distinguishing the two would require a "no-slash
// path = bucket op" routing rule that reinterprets every legacy flat-key
// PUT/DELETE/HEAD (and would force existing objects under a `default/` prefix),
// so bucket endpoints are deliberately left out to keep object semantics intact.
//
// The practical consequence: S3 clients must set `no_check_bucket = true` so
// they never emit CreateBucket or HeadBucket — buckets are created implicitly
// on the first object write. A bare
// PUT/DELETE/HEAD is therefore dispatched below as an ordinary object op:
//   PUT  → PutObject       HEAD → HeadObject
//   DELETE → DeleteObject (204; soft-delete — the S3 namespace is mutable)
// There is deliberately no CreateBucket / DeleteBucket / HeadBucket entry.
const S3HandlerConfig: S3HandlerConfig = {
  GetObject: getObjectHandler,
  HeadObject: headObjectHandler,
  PutObject: putObjectHandler,
  CreateMultipartUpload: createMultipartUploadHandler,
  UploadPart: uploadPartHandler,
  CompleteMultipartUpload: completeMultipartUploadHandler,
  DeleteObject: deleteObjectHandler,
  // DeleteObject?versionId → 403: a version can never be destroyed (WORM).
  DeleteObjectVersion: deleteObjectVersionHandler,
  CopyObject: copyObjectHandler,
  AbortMultipartUpload: abortMultipartUploadHandler,
  ListBuckets: listBucketsHandler,
  ListObjectsV2: listObjectsV2Handler,
  // Versioning is always on (versionId = CID). GetBucketVersioning reports
  // Enabled; ListObjectVersions enumerates the append-only history.
  GetBucketVersioning: getBucketVersioningHandler,
  ListObjectVersions: listObjectVersionsHandler,
  // Object Lock — read-only declarative contract, now an honest COMPLIANCE/WORM
  // lock: the underlying DSN data is permanent and versions are indestructible.
  GetObjectLockConfiguration: getObjectLockConfigurationHandler,
  GetObjectRetention: getObjectRetentionHandler,
  GetObjectLegalHold: getObjectLegalHoldHandler,
  // Recognised but unimplemented — mapped to 501, never to a write handler.
  ListParts: notImplementedHandler,
  ListMultipartUploads: notImplementedHandler,
  // Server-side part copy (large-object CopyObject): 501 so it fails cleanly
  // instead of being misrouted to UploadPart and corrupting the object.
  UploadPartCopy: notImplementedHandler,
  PostObject: notImplementedHandler,
  // Object Lock is intrinsic and cannot be configured by clients — 501.
  PutObjectLockConfiguration: notImplementedHandler,
  PutObjectRetention: notImplementedHandler,
  PutObjectLegalHold: notImplementedHandler,
  // Versioning is always on and cannot be toggled off — 501.
  PutBucketVersioning: notImplementedHandler,
}

// Match on method first: the same query param (?uploadId, ?uploads) selects a
// different operation per verb.
export const getS3Method = (req: Request): string => {
  const q = req.query
  const isCopy = req.headers['x-amz-copy-source'] != null

  switch (req.method) {
    case 'GET':
      if ('uploadId' in q) return 'ListParts'
      if ('uploads' in q) return 'ListMultipartUploads'
      if ('versioning' in q) return 'GetBucketVersioning'
      if ('versions' in q) return 'ListObjectVersions'
      if ('object-lock' in q) return 'GetObjectLockConfiguration'
      if ('retention' in q) return 'GetObjectRetention'
      if ('legal-hold' in q) return 'GetObjectLegalHold'
      if (q['list-type'] === '2') return 'ListObjectsV2'
      return 'GetObject'
    case 'HEAD':
      return 'HeadObject'
    case 'PUT':
      if ('uploadId' in q && 'partNumber' in q) {
        // UploadPartCopy (a part sourced from x-amz-copy-source) is unsupported;
        // route it to 501 rather than UploadPart, whose handler would read an
        // empty body and silently corrupt the object. Only rclone server-side
        // copies of very large files (>= --s3-copy-cutoff, ~4.66 GiB) hit this.
        if (isCopy) return 'UploadPartCopy'
        return 'UploadPart'
      }
      // Versioning is always on and not client-configurable; route an attempted
      // toggle to 501 rather than letting it fall through to PutObject (which
      // would store the config XML as an object under the bucket key).
      if ('versioning' in q) return 'PutBucketVersioning'
      if ('object-lock' in q) return 'PutObjectLockConfiguration'
      if ('retention' in q) return 'PutObjectRetention'
      if ('legal-hold' in q) return 'PutObjectLegalHold'
      if (isCopy) return 'CopyObject'
      return 'PutObject'
    case 'POST':
      if ('uploads' in q) return 'CreateMultipartUpload'
      if ('uploadId' in q) return 'CompleteMultipartUpload'
      return 'PostObject'
    case 'DELETE':
      if ('uploadId' in q) return 'AbortMultipartUpload'
      // A versioned delete targets a specific version — refused (WORM).
      if ('versionId' in q) return 'DeleteObjectVersion'
      return 'DeleteObject'
    default:
      return 'Unknown'
  }
}

// The S3 write ops that may carry a client Content-Encoding the body parser must
// not see. Two reasons, handled identically:
//  - PutObject / UploadPart: the request body IS the stored object, so it must be
//    kept byte-for-byte — S3 never inflates a stored body; Content-Encoding is
//    opaque metadata. Left alone, Express gunzips gzip/deflate bodies (stored
//    bytes then wouldn't match the declared encoding) or 415s unknown encodings
//    (br, zstd) before they can be stored.
//  - CreateMultipartUpload / CopyObject: no stored body, but Content-Encoding
//    rides along as pure metadata on an empty body the parser still inspects.
//    body-parser checks the encoding before it notices the body is empty
//    (Content-Length: 0 counts as "has body"), so 'br' → 415 and 'gzip' → 400
//    (gunzip on empty input) before the handler could read it as metadata.
// For all of them, neutralizeContentEncoding moves the header onto a
// request-scoped stash that getObjectMetadata reads back.
const CONTENT_ENCODING_WRITE_OPS = new Set([
  'PutObject',
  'UploadPart',
  'CreateMultipartUpload',
  'CopyObject',
])

// Move a client-declared Content-Encoding out of the way of the body parser for
// those ops (see above), preserving it under a request-scoped stash for metadata
// capture; GetObject/HeadObject re-emit it. aws-chunked is AWS transfer framing,
// not object content: leave it in place so the parser's existing handling stands
// rather than storing the framing bytes as data.
const neutralizeContentEncoding = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const encoding = req.headers['content-encoding']
  if (
    typeof encoding === 'string' &&
    encoding.toLowerCase() !== 'identity' &&
    !encoding.toLowerCase().includes('aws-chunked') &&
    CONTENT_ENCODING_WRITE_OPS.has(getS3Method(req))
  ) {
    // Stash on a request-scoped side channel (not a header) so it round-trips as
    // metadata without being forgeable over the wire, then hide the real header
    // from the parser (which would otherwise inflate a stored body, or 415/400 on
    // an empty one).
    stashContentEncoding(req, encoding)
    delete req.headers['content-encoding']
  }
  next()
}

s3Controller.get(
  '/',
  asyncSafeHandler(async (req: Request, res: Response) => {
    // ?uploads at the bucket root is ListMultipartUploads, not ListBuckets.
    if ('uploads' in req.query) {
      return notImplementedHandler(req, res)
    }
    return listBucketsHandler(req, res)
  }),
)

s3Controller.use(
  '/:key(*)',
  // Runs before the parser: moves a client Content-Encoding aside for the write
  // ops that carry it, so the parser neither inflates a stored body nor 415/400s
  // on an empty one (see above).
  neutralizeContentEncoding,
  // S3 object bodies are opaque binary payloads. Always read the request body
  // as raw bytes regardless of (or the absence of) a Content-Type header.
  // `type: '*/*'` is insufficient: type-is returns false when no Content-Type
  // header is present, which the AWS CLI omits on PutObject/UploadPart — that
  // left req.body as `{}` and broke uploads.
  raw({
    type: () => true,
    limit: '100mb',
  }),
  asyncSafeHandler(async (req: Request, res: Response) => {
    const s3Method = getS3Method(req)

    const handler = S3HandlerConfig[s3Method as keyof typeof S3HandlerConfig]
    if (!handler) {
      logger.warn('Unsupported S3 request: %s %s', req.method, req.originalUrl)
      return notImplementedHandler(req, res)
    }

    return handler(req, res)
  }),
)

export { s3Controller }
