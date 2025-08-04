import { raw, Router, Request, Response } from 'express'
import { asyncSafeHandler } from '../../../shared/utils/express.js'
import { handleError } from '../../../errors/index.js'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import {
  completeMultipartUploadHandler,
  createMultipartUploadHandler,
  getObjectHandler,
  putObjectHandler,
  uploadPartHandler,
} from './s3.js'

const s3Controller = Router()

const logger = createLogger('http:controllers:s3')

type S3HandlerConfig = {
  [key: string]: {
    handler: (req: Request, res: Response) => Promise<void>
    methods: string[]
  }
}

const S3HandlerConfig: S3HandlerConfig = {
  GetObject: {
    handler: getObjectHandler,
    methods: ['GET'],
  },
  PutObject: {
    handler: putObjectHandler,
    methods: ['PUT'],
  },
  CreateMultipartUpload: {
    handler: createMultipartUploadHandler,
    methods: ['POST'],
  },
  UploadPart: {
    handler: uploadPartHandler,
    methods: ['PUT', 'POST'],
  },
  CompleteMultipartUpload: {
    handler: completeMultipartUploadHandler,
    methods: ['POST'],
  },
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
  }
  return s3Method
}

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

    return handler.handler(req, res)
  }),
)

export { s3Controller }
