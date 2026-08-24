import { NextFunction, Request, Response } from 'express'
import {
  handleAuth,
  tryAuthenticate,
} from '../../infrastructure/services/auth/express.js'
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
    try {
      // Authenticate the user if credentials are present.
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
    } catch (error) {
      // Log and return 500 rather than letting the rejection go unhandled,
      // which would crash the process in Express 4.
      logger.error(error, 'featureFlagMiddleware: unexpected error')
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }

// Returns feature flags for the current request.  Used by the public
// /features endpoint.  On auth failure it falls back to unauthenticated
// flags so the endpoint always returns a result.
//
// tryAuthenticate, not handleAuth: handleAuth answers the request itself (401,
// or 503 when the auth service is unreachable), which would make the endpoint
// fail on a stale token instead of degrading to the unauthenticated flags it
// promises. A credential that cannot be resolved is simply no credential here.
export const getFeatureFlags = async (req: Request) => {
  if (req.headers.authorization) {
    const user = await tryAuthenticate(req)
    if (!user) {
      logger.debug(
        'Could not resolve the request credentials; serving unauthenticated flags',
      )
    }
    return FeatureFlagsUseCases.get(user)
  }

  return FeatureFlagsUseCases.get(null)
}
