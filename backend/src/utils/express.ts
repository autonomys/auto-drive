import { NextFunction, Request, Response } from 'express'

export const asyncSafeHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => unknown,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next)
    } catch (err) {
      next(err)
    }
  }
}
