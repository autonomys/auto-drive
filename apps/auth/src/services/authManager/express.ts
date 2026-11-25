import { NextFunction, Request, Response } from 'express'
import {
  MaybeUser,
  OAuthUser,
  SERVICE_USER_PROVIDER,
  User,
  UserRole,
} from '@auto-drive/models'
import { OrganizationsUseCases, UsersUseCases } from '../../useCases/index.js'
import { AuthManager } from './index.js'
import { CustomJWTAuth } from './providers/custom.js'
import { Web3SignInRefused } from './providers/web3.js'
import { config } from '../../config.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('authManager:express')

// The requests whose route lets partner end users in. Keyed by the request,
// so a client cannot set it.
const endUserRoutes = new WeakSet<Request>()

/**
 * Lets partner end users use the route behind it. Every other route that
 * takes a user's credential refuses them, so a route added later stays closed
 * to them until it declares this.
 */
export const allowPartnerEndUsers =
  () => (req: Request, _res: Response, next: NextFunction) => {
    endUserRoutes.add(req)
    next()
  }

// Answers 403 and resolves true when the user is a partner end user and the
// route does not let them in.
const refusePartnerEndUser = async (
  req: Request,
  res: Response,
  user: MaybeUser,
): Promise<boolean> => {
  if (
    !user.onboarded ||
    endUserRoutes.has(req) ||
    !(await OrganizationsUseCases.isPartnerEndUser(user))
  ) {
    return false
  }
  res.status(403).json({ error: 'Not available to partner end users' })
  return true
}

export const handleAuth = async (
  req: Request,
  res: Response,
): Promise<User | null> => {
  logger.trace('handleAuth called')
  const user = await handleAuthIgnoreOnboarding(req, res)

  if (!user) {
    return null
  }

  // Callers return as soon as this yields null, so the rejection has to be
  // sent here — otherwise the request is left open until the client times out.
  if (!user.onboarded) {
    res.status(403).json({ error: 'User not onboarded' })
    return null
  }

  // Organisation keys are for the backend, which resolves them with GET /@me.
  // They can't manage keys or request the service user's deletion.
  if (user.oauthProvider === SERVICE_USER_PROVIDER) {
    res.status(403).json({ error: 'Not available to organization API keys' })
    return null
  }

  return user
}

export const handleAuthIgnoreOnboarding = async (
  req: Request,
  res: Response,
): Promise<
  (MaybeUser & Pick<OAuthUser, 'apiKeyId' | 'apiKeyScopes'>) | null
> => {
  logger.trace('handleAuthIgnoreOnboarding called')
  const accessToken = req.headers.authorization?.split(' ')[1]
  if (!accessToken) {
    res.status(401).json({
      error: 'Missing or invalid access token',
    })
    return null
  }

  const provider = req.headers['x-auth-provider']
  if (!provider || typeof provider !== 'string') {
    res.status(401).json({
      error: 'Missing or invalid x-auth-provider header',
    })

    return null
  }

  let reason: string | undefined
  const oauthUser = await AuthManager.getUserFromAccessToken(
    provider,
    accessToken,
  ).catch((e) => {
    logger.error('Failed to get user from access token', e)
    // Only for a wallet sign-in whose signature verified.
    if (e instanceof Web3SignInRefused) reason = e.reason
    return null
  })

  if (!oauthUser) {
    res.status(401).json({
      error: 'Failed to authenticate user',
      ...(reason && { reason }),
    })
    return null
  }

  const user = await UsersUseCases.getUserByOAuthUser(oauthUser)
  if (await refusePartnerEndUser(req, res, user)) {
    return null
  }
  // The key and what it may be used for, which GET /@me passes on to the
  // backend.
  return oauthUser.apiKeyId
    ? {
        ...user,
        apiKeyId: oauthUser.apiKeyId,
        apiKeyScopes: oauthUser.apiKeyScopes ?? null,
      }
    : user
}

export const handleAdminAuth = async (
  req: Request,
  res: Response,
): Promise<boolean> => {
  const accessToken = req.headers.authorization?.split(' ')[1]
  const provider = req.headers['x-auth-provider']

  if (!accessToken) {
    res.status(401).json({
      error: 'Missing or invalid access token',
    })
    return false
  }

  const isCorrectApiSecret = accessToken === config.apiSecret
  if (isCorrectApiSecret) {
    return true
  }

  if (!(provider && typeof provider === 'string')) {
    res.status(401).json({
      error: 'Missing or invalid x-auth-provider header',
    })
    return false
  }

  const oauthUser = await AuthManager.getUserFromAccessToken(
    provider,
    accessToken,
  ).catch((e) => {
    logger.error(e)
    return null
  })

  if (!oauthUser) {
    res.status(401).json({
      error: 'Failed to authenticate user',
    })
    return false
  }

  const user = await UsersUseCases.getUserByOAuthUser(oauthUser)
  if (!user) {
    res.status(401).json({
      error: 'Failed to authenticate user',
    })
    return false
  }
  if (await refusePartnerEndUser(req, res, user)) {
    return false
  }

  const isAdmin = user.role === UserRole.Admin
  if (!isAdmin) {
    res.status(401).json({
      error: 'Unauthorized',
    })
    return false
  }

  return isAdmin
}

/**
 * Accepts the backend only, by its service secret, and never a user token.
 * Membership changes have preconditions on backend data (credits, payments),
 * so admins make them through the backend rather than here.
 */
export const handleServiceAuth = (req: Request, res: Response): boolean => {
  const accessToken = req.headers.authorization?.split(' ')[1]
  if (!config.apiSecret || accessToken !== config.apiSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

// Resolves null once it has answered.
export const refreshAccessToken = async (
  req: Request,
  res: Response,
  refreshToken: string,
): Promise<string | null> => {
  // Partner end users get no refresh token. This refuses one issued earlier.
  const user = await CustomJWTAuth.getUserFromRefreshToken(refreshToken)
  if (await refusePartnerEndUser(req, res, user)) {
    return null
  }
  return CustomJWTAuth.refreshAccessToken(refreshToken)
}
