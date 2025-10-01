import { NextFunction, Request, Response } from 'express'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { FeatureFlagsUseCases } from './index.js'
import { config } from '../../config.js'

export type FeatureFlagKey = keyof typeof config.featureFlags.flags

export const featureFlagMiddleware =
  (key: FeatureFlagKey) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const featureFlags = await getFeatureFlags(req, res)
    if (!featureFlags) {
      return
    }

    if (featureFlags[key]) {
      next()
    } else {
      res.sendStatus(404)
    }
  }

export const getFeatureFlags = async (req: Request, res: Response) => {
  // If is authenticated, get the user from the request
  if (req.headers) {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    return FeatureFlagsUseCases.get(user)
  }

  return FeatureFlagsUseCases.get(null)
}
