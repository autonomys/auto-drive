import { NextFunction, Request, Response } from 'express'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { FeatureFlagsUseCases } from './index.js'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('core:featureFlags:express')

export type FeatureFlagKey = keyof typeof config.featureFlags.flags

// Middleware that gates a route behind a feature flag.
//
// Unlike `getFeatureFlags` (used by the public /features endpoint), this
// middleware does NOT silently fall back to unauthenticated flags on auth
// failure.  If the request includes credentials but auth fails (e.g. the
// auth service is unreachable, or the API key is invalid), the middleware
// lets the auth error surface rather than hiding the route behind a 404.
export const featureFlagMiddleware =
  (key: FeatureFlagKey) =>
  async (req: Request, res: Response, next: NextFunction) => {
    // Authenticate the user if credentials are present.  Let auth errors
    // propagate — the caller (asyncSafeHandler / Express error handler)
    // will return a proper error instead of a misleading 404.
    let user = null
    if (req.headers.authorization) {
      user = await handleAuth(req, res)
      if (!user) {
        // handleAuth already sent a 401 response
        return
      }
    }

    const featureFlags = FeatureFlagsUseCases.get(user)

    if (featureFlags[key]) {
      next()
    } else {
      if (user) {
        logger.debug(
          'Feature flag %s is not active for user (oauthProvider=%s)',
          key,
          user.oauthProvider,
        )
      }
      res.sendStatus(404)
    }
  }

// Returns feature flags for the current request.  Used by the public
// /features endpoint.  On auth failure it falls back to unauthenticated
// flags so the endpoint always returns a result.
export const getFeatureFlags = async (req: Request, res: Response) => {
  // If is authenticated, get the user from the request
  if (req.headers.authorization) {
    try {
      const user = await handleAuth(req, res)
      if (!user) {
        return
      }

      return FeatureFlagsUseCases.get(user)
    } catch (error) {
      logger.warn(error, 'Auth failed in getFeatureFlags, falling back to unauthenticated flags')
      // Auth failure — fall through to unauthenticated flags
      return FeatureFlagsUseCases.get(null)
    }
  }

  return FeatureFlagsUseCases.get(null)
}
