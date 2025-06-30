import { NextFunction, Request, Response } from 'express'
import { requestTrace } from '../http/middlewares/requestTrace.js'
import { config } from '../config.js'
import { createLogger } from '../drivers/logger.js'

const reqLogger = createLogger('http:request')

export const asyncSafeHandler = (
  fn: (req: Request, res: Response) => unknown,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      reqLogger.trace('START %s %s', req.method, req.originalUrl)
      await fn(req, res)
      reqLogger.trace('END   %s %s %d', req.method, req.originalUrl, res.statusCode)
      if (config.monitoring.active) {
        requestTrace(req, res, next)
      } else {
        reqLogger.debug('Request trace disabled')
      }
    } catch (err) {
      reqLogger.error('Unhandled error in handler for %s %s', req.method, req.originalUrl, err)
      next(err)
    }
  }
}
