import { raw, Router, Request, Response } from 'express'
import { asyncSafeHandler } from '../../../shared/utils/express.js'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import {
  completeMultipartUploadHandler,
  createMultipartUploadHandler,
  deleteObjectHandler,
  getObjectHandler,
  getObjectLegalHoldHandler,
  getObjectLockConfigurationHandler,
  getObjectRetentionHandler,
  headObjectHandler,
  listBucketsHandler,
  listObjectsV2Handler,
  notImplementedHandler,
  putObjectHandler,
  uploadPartHandler,
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
//   DELETE → DeleteObject (403, storage is immutable)
// There is deliberately no CreateBucket / DeleteBucket / HeadBucket entry.
const S3HandlerConfig: S3HandlerConfig = {
  GetObject: getObjectHandler,
  HeadObject: headObjectHandler,
  PutObject: putObjectHandler,
  CreateMultipartUpload: createMultipartUploadHandler,
  UploadPart: uploadPartHandler,
  CompleteMultipartUpload: completeMultipartUploadHandler,
  DeleteObject: deleteObjectHandler,
  ListBuckets: listBucketsHandler,
  ListObjectsV2: listObjectsV2Handler,
  // Object Lock — read-only declarative contract (Auto Drive is immutable).
  GetObjectLockConfiguration: getObjectLockConfigurationHandler,
  GetObjectRetention: getObjectRetentionHandler,
  GetObjectLegalHold: getObjectLegalHoldHandler,
  // Recognised but unimplemented — mapped to 501, never to a write handler.
  CopyObject: notImplementedHandler,
  ListParts: notImplementedHandler,
  ListMultipartUploads: notImplementedHandler,
  AbortMultipartUpload: notImplementedHandler,
  PostObject: notImplementedHandler,
  // Object Lock is intrinsic and cannot be configured by clients — 501.
  PutObjectLockConfiguration: notImplementedHandler,
  PutObjectRetention: notImplementedHandler,
  PutObjectLegalHold: notImplementedHandler,
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
      if ('object-lock' in q) return 'GetObjectLockConfiguration'
      if ('retention' in q) return 'GetObjectRetention'
      if ('legal-hold' in q) return 'GetObjectLegalHold'
      if (q['list-type'] === '2') return 'ListObjectsV2'
      return 'GetObject'
    case 'HEAD':
      return 'HeadObject'
    case 'PUT':
      if ('uploadId' in q && 'partNumber' in q) return 'UploadPart'
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
      return 'DeleteObject'
    default:
      return 'Unknown'
  }
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
