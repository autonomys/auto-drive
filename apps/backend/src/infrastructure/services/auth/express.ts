import { Request, Response } from 'express'
import { UserWithOrganization } from '@auto-drive/models'
import { AuthManager, classifyAuthFailure } from './index.js'
import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('services:auth:express')

/**
 * The credentials on a request: the bearer token and the provider that issued
 * it. Null when either is absent, which is "no credentials", never a rejection.
 */
const readCredentials = (
  req: Request,
): { accessToken: string; provider: string } | null => {
  const accessToken = req.headers.authorization?.split(' ')[1]
  const provider = req.headers['x-auth-provider']
  if (!accessToken || typeof provider !== 'string') return null
  return { accessToken, provider }
}

/**
 * Resolve the request's credentials to a user WITHOUT writing a response.
 *
 * For the callers that have their own answer for an unauthenticated request —
 * the public /features endpoint degrades to unauthenticated flags rather than
 * failing — so they are not forced to choose between handleAuth's 401 and
 * catching an exception. Returns null for every failure: no credentials, a
 * refused credential, or an auth service that could not answer.
 */
export const tryAuthenticate = async (
  req: Request,
): Promise<UserWithOrganization | null> => {
  const credentials = readCredentials(req)
  if (!credentials) return null

  try {
    return await AuthManager.getUserFromAccessToken(
      credentials.provider,
      credentials.accessToken,
    )
  } catch (error) {
    logger.warn(error, 'Token lookup failed')
    return null
  }
}

export const handleAuth = async (
  req: Request,
  res: Response,
): Promise<UserWithOrganization | null> => {
  const credentials = readCredentials(req)
  if (!credentials) {
    res.status(401).json({
      error: 'Missing or invalid access token',
    })
    return null
  }

  // A failed lookup must be answered here. Letting it throw reaches Express's
  // default error handler, which answers an HTML 500 — a retryable status for a
  // credential that will never work.
  let user: UserWithOrganization
  try {
    user = await AuthManager.getUserFromAccessToken(
      credentials.provider,
      credentials.accessToken,
    )
  } catch (error) {
    if (classifyAuthFailure(error) === 'unavailable') {
      // The question could not be answered — the auth service is down, or this
      // service has a bug. Either way the credential was never judged, so 503
      // lets a client back off and retry instead of discarding a working token.
      logger.error(error, 'Auth service could not answer a token lookup')
      res.status(503).json({
        error: 'Authentication service unavailable',
      })
      return null
    }
    // Logged, not swallowed: before this branch existed the throw reached
    // asyncSafeHandler, which was the only place an auth failure was recorded.
    logger.info(error, 'Rejected a request with an unusable credential')
    res.status(401).json({
      error: 'Failed to authenticate user',
    })
    return null
  }

  if (!user) {
    res.status(401).json({
      error: 'Failed to authenticate user',
    })
    return null
  }

  return user
}

export const handleOptionalAuth = async (
  req: Request,
  res: Response,
): Promise<UserWithOrganization | boolean | null> => {
  const accessToken = req.headers.authorization?.split(' ')[1]
  const providerHeader = req.headers['x-auth-provider']
  const hasAuthHeaders =
    typeof accessToken === 'string' && typeof providerHeader === 'string'

  // If credentials are provided, always attempt to authenticate the user,
  // regardless of OPTIONAL_AUTH flag. This ensures API keys and tokens are honored.
  if (hasAuthHeaders) {
    return handleAuth(req, res)
  }

  // If OPTIONAL_AUTH is enabled and no credentials are provided,
  // allow anonymous access by returning true.
  if (config.params.optionalAuth) return true

  return handleAuth(req, res)
}
