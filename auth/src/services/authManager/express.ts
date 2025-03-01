import { Request, Response } from 'express'
import { MaybeUser, User } from '@auto-drive/models'
import { UsersUseCases } from '../../useCases/index.js'
import { AuthManager } from './index.js'
import { CustomJWTAuth } from './providers/custom.js'
import { config } from '../../config.js'

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

export const handleApiSecretAuth = async (
  req: Request,
  res: Response,
): Promise<true | null> => {
  const accessToken = req.headers.authorization?.split(' ')[1]

  if (!accessToken) {
    res.status(401).json({
      error: 'Missing or invalid access token',
    })
    return null
  }

  const isCorrectApiSecret = accessToken === config.apiSecret
  if (!isCorrectApiSecret) {
    res.status(401).json({
      error: 'Unauthorized',
    })
    return null
  }

  return isCorrectApiSecret
}

export const refreshAccessToken = async (
  refreshToken: string,
): Promise<string | null> => {
  return CustomJWTAuth.refreshAccessToken(refreshToken)
}
