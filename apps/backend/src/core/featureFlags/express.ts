import { NextFunction, Request, Response } from 'express'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { FeatureFlagsUseCases } from './index.js'
import { UsdcPaymentsUseCases } from '../payments/usdc.js'
import { config, isUsdcConfigured } from '../../config.js'
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
// AUDIENCE ONLY for payWithUsdc: this asks whether the caller may use the
// feature, not whether the deployment is currently selling it. The USDC
// availability gates (admin kill switch, treasury cap, oracle) are enforced in
// `createIntent` and reported by /features — do not gate a USDC route on this
// alone and assume the path is open.
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
 * Add the deployment's USDC availability to the flags a client is told about.
 *
 * Two keys, because they answer two questions and one boolean cannot:
 *
 *   payWithUsdc    — audience AND availability: "should this caller be offered
 *                    the USDC option right now". Narrowed here so a client
 *                    cannot render a path the backend would refuse, which is the
 *                    failure `isFlagActive` exists to prevent. Note that every
 *                    OTHER reader of this flag (`isFlagActive`,
 *                    `featureFlagMiddleware`) gets audience only.
 *   usdcAvailable  — availability alone. Lets a dashboard distinguish "not your
 *                    audience" from "the deployment is not selling", which a
 *                    single false conflates — and it is the honest answer for an
 *                    admin, who is exempt from the audience gate but not from
 *                    these.
 *
 * Both come from `UsdcPaymentsUseCases.getAvailability`, the same function
 * `createIntent` calls, so the advertisement and the refusal cannot drift — and
 * with no cache in between, they cannot lag it either.
 *
 * Fails CLOSED and never throws. This endpoint could not touch the database
 * before this existed, it is mounted on the download API as well as the frontend
 * one, and its route handler has no async error boundary — so an unhandled
 * rejection here (the migration not yet applied, a connection-pool timeout) would
 * take down downloads and S3 over a payments read. `createIntent` enforces the
 * gate independently, so advertising `false` on a failed read costs a hidden
 * button and nothing else.
 */
export const withUsdcAvailability = async (
  flags: Record<string, boolean>,
): Promise<Record<string, boolean>> => {
  // The cheapest possible answer for the deployments that do not sell USDC: no
  // query, no cache entry, and one fewer place that can fail.
  if (!isUsdcConfigured()) {
    return { ...flags, payWithUsdc: false, usdcAvailable: false }
  }

  try {
    const availability = await UsdcPaymentsUseCases.getAvailability()
    return {
      ...flags,
      payWithUsdc: flags.payWithUsdc && availability.open,
      usdcAvailable: availability.open,
    }
  } catch (error) {
    logger.error(
      error,
      'Could not read USDC availability; advertising the path as closed',
    )
    return { ...flags, payWithUsdc: false, usdcAvailable: false }
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

      // `return await`, not `return`: a bare return would hand the promise back
      // out of the try and the catch below could never see its rejection.
      return await withUsdcAvailability(FeatureFlagsUseCases.get(user))
    } catch (error) {
      logger.warn(error, 'Auth failed in getFeatureFlags, falling back to unauthenticated flags')
      // Auth failure — fall through to unauthenticated flags
      return await withUsdcAvailability(FeatureFlagsUseCases.get(null))
    }
  }

  return await withUsdcAvailability(FeatureFlagsUseCases.get(null))
}
