import { NextFunction, Request, Response } from 'express'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { FeatureFlagsUseCases } from './index.js'
import { UsdcPaymentsUseCases } from '../payments/usdc.js'
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

/**
 * Narrow `payWithUsdc` from "may this caller pay in USDC" to "and is this
 * deployment selling it right now".
 *
 * The flag on its own answers the audience question, and admins are exempt from
 * it. But the endpoint's whole job is to tell the client which paths are open,
 * and offering a method the backend then refuses is the exact failure
 * `isFlagActive` exists to prevent — so what /features reports has to be the
 * same conjunction createIntent evaluates. Both call
 * UsdcPaymentsUseCases.getAvailability(), which is why they cannot drift.
 *
 * Notably this makes an admin on a deployment with no Ethereum configuration
 * read `false`, where the exemption alone said `true` and the quote then 403'd.
 *
 * One indexed read, and only when the flag survived the audience check: the
 * closed path costs nothing, and the open one is a page load against a table
 * with two rows. Uncached deliberately — a kill switch whose effect waits out a
 * TTL is not the control an incident needs.
 */
const withUsdcAvailability = async (
  flags: Record<string, boolean>,
): Promise<Record<string, boolean>> => {
  if (!flags.payWithUsdc) {
    return flags
  }

  const availability = await UsdcPaymentsUseCases.getAvailability()
  return { ...flags, payWithUsdc: availability.open }
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

      return withUsdcAvailability(FeatureFlagsUseCases.get(user))
    } catch (error) {
      logger.warn(error, 'Auth failed in getFeatureFlags, falling back to unauthenticated flags')
      // Auth failure — fall through to unauthenticated flags
      return withUsdcAvailability(FeatureFlagsUseCases.get(null))
    }
  }

  return withUsdcAvailability(FeatureFlagsUseCases.get(null))
}
