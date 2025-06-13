import { Request, Response } from 'express'
import { MaybeUser, User, UserRole } from '@auto-drive/models'
import { UsersUseCases } from '../../useCases/index.js'
import { AuthManager } from './index.js'
import { CustomJWTAuth } from './providers/custom.js'
import { config } from '../../config.js'
import { logger } from '../../drivers/logger.js'

export const handleAuth = async (
  req: Request,
  res: Response,
): Promise<User | null> => {
  const user = await handleAuthIgnoreOnboarding(req, res)

  if (!user?.onboarded) {
    return null
  }

  return user
}

export const handleAuthIgnoreOnboarding = async (
  req: Request,
  res: Response,
): Promise<MaybeUser | null> => {
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

  const oauthUser = await AuthManager.getUserFromAccessToken(
    provider,
    accessToken,
  ).catch((e) => {
    console.error(e)
    return null
  })

  if (!oauthUser) {
    res.status(401).json({
      error: 'Failed to authenticate user',
    })
    return null
  }

  return UsersUseCases.getUserByOAuthUser(oauthUser)
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

  const isAdmin = user.role === UserRole.Admin
  if (!isAdmin) {
    res.status(401).json({
      error: 'Unauthorized',
    })
    return false
  }

  return isAdmin
}

export const refreshAccessToken = async (
  refreshToken: string,
): Promise<string | null> => {
  return CustomJWTAuth.refreshAccessToken(refreshToken)
}
