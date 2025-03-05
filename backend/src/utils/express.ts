import { NextFunction, Request, Response } from 'express'
import { requestTrace } from '../http/middlewares/requestTrace.js'
import { config } from '../config.js'

export const asyncSafeHandler = (
  fn: (req: Request, res: Response) => unknown,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res)
      if (config.monitoring.active) {
        requestTrace(req, res, next)
      } else {
        console.log('Request trace disabled')
      }
    } catch (err) {
      next(err)
    }
  }
}
