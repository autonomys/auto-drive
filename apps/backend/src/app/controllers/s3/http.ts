import { raw, Router, Request, Response } from 'express'
import { asyncSafeHandler } from '../../../shared/utils/express.js'
import { handleError } from '../../../errors/index.js'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import {
  completeMultipartUploadHandler,
  createMultipartUploadHandler,
  deleteObjectHandler,
  getObjectHandler,
  headObjectHandler,
  listBucketsHandler,
  listObjectsV2Handler,
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
}

const getS3Method = (req: Request) => {
  const { 'x-id': s3Method } = req.query
  if (!s3Method) {
    if ('uploads' in req.query) {
      return 'CreateMultipartUpload'
    }
    if ('uploadId' in req.query && 'partNumber' in req.query) {
      return 'UploadPart'
    }
    if ('uploadId' in req.query) {
      return 'CompleteMultipartUpload'
    }
    if (req.query['list-type'] === '2') {
      return 'ListObjectsV2'
    }
    if (req.method === 'HEAD') {
      return 'HeadObject'
    }
    if (req.method === 'DELETE') {
      return 'DeleteObject'
    }
  }
  return s3Method
}

// ListBuckets: GET / with no key path
s3Controller.get(
  '/',
  asyncSafeHandler(async (req: Request, res: Response) => {
    return listBucketsHandler(req, res)
  }),
)

s3Controller.use(
  '/:key(*)',
  raw({
    type: '*/*',
    limit: '100mb',
  }),
  asyncSafeHandler(async (req: Request, res: Response) => {
    const s3Method = getS3Method(req)

    const handler = S3HandlerConfig[s3Method as keyof typeof S3HandlerConfig]
    if (!handler) {
      logger.error('Method not found')
      return handleError(new Error('Method not found'), res)
    }

    return handler(req, res)
  }),
)

export { s3Controller }
