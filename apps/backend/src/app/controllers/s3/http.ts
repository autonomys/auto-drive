import { raw, Router, Request, Response } from 'express'
import { asyncSafeHandler } from '../../../shared/utils/express.js'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import {
  completeMultipartUploadHandler,
  createMultipartUploadHandler,
  deleteObjectHandler,
  getObjectHandler,
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
  // Recognised but unimplemented. Routed explicitly to a 501 so a request is
  // never mistaken for a similarly-shaped supported one — e.g. GET ?uploadId
  // (ListParts) must not reach CompleteMultipartUpload and finalise the
  // upload.
  CopyObject: notImplementedHandler,
  ListParts: notImplementedHandler,
  ListMultipartUploads: notImplementedHandler,
  AbortMultipartUpload: notImplementedHandler,
  PostObject: notImplementedHandler,
}

// Resolve the S3 operation from the HTTP method first, then disambiguate by
// query params / headers. Method-first matters: GET ?uploadId (ListParts) and
// POST ?uploadId (CompleteMultipartUpload) share a query param but are
// different operations, and only the latter is a write.
const getS3Method = (req: Request): string => {
  const q = req.query
  const isCopy = req.headers['x-amz-copy-source'] != null

  switch (req.method) {
    case 'GET':
      if ('uploadId' in q) return 'ListParts'
      if ('uploads' in q) return 'ListMultipartUploads'
      if (q['list-type'] === '2') return 'ListObjectsV2'
      return 'GetObject'
    case 'HEAD':
      return 'HeadObject'
    case 'PUT':
      if ('uploadId' in q && 'partNumber' in q) return 'UploadPart'
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

// ListBuckets: GET / with no key path.  Bucket-level sub-resource requests
// also land here when the bucket is the endpoint (e.g. ListMultipartUploads is
// GET /?uploads); route those to 501 rather than returning the bucket list.
s3Controller.get(
  '/',
  asyncSafeHandler(async (req: Request, res: Response) => {
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
      // Unrecognised verb/shape — reject as unimplemented rather than 500.
      logger.warn('Unsupported S3 request: %s %s', req.method, req.originalUrl)
      return notImplementedHandler(req, res)
    }

    return handler(req, res)
  }),
)

export { s3Controller }
