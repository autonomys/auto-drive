import { Request, Response } from 'express'
import { UserWithOrganization } from '@auto-drive/models'
import { AuthLookupError, AuthManager } from './index.js'
import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('services:auth:express')

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
  const accessToken = req.headers.authorization?.split(' ')[1]
  const provider = req.headers['x-auth-provider']
  if (!accessToken || typeof provider !== 'string') return null

  try {
    return await AuthManager.getUserFromAccessToken(provider, accessToken)
  } catch (error) {
    logger.warn(error, 'Token lookup failed')
    return null
  }
}

export const handleAuth = async (
  req: Request,
  res: Response,
): Promise<UserWithOrganization | null> => {
  const accessToken = req.headers.authorization?.split(' ')[1]
  if (!accessToken) {
    res.status(401).json({
      error: 'Missing or invalid access token',
    })
    return null
  }

  const provider = req.headers['x-auth-provider']
  if (typeof provider !== 'string') {
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
    user = await AuthManager.getUserFromAccessToken(provider, accessToken)
  } catch (error) {
    if (error instanceof AuthLookupError && !error.isCredentialFailure) {
      // The auth service is down, not the credential. 503 so a client backs off
      // and retries rather than treating its token as invalid.
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
