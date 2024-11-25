import { Request, Response } from 'express'
import { User } from '../../models/users/index.js'
import { UsersUseCases } from '../../useCases/index.js'
import { AuthManager } from './index.js'
import { CustomJWTAuth } from './providers/custom.js'

export const handleAuth = async (
  req: Request,
  res: Response,
): Promise<User | null> => {
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
  ).catch(() => null)
  if (!oauthUser) {
    res.status(401).json({
      error: 'Failed to authenticate user',
    })
    return null
  }

  return UsersUseCases.getUserByOAuthUser(oauthUser)
}

export const refreshAccessToken = async (
  refreshToken: string,
): Promise<string | null> => {
  return CustomJWTAuth.refreshAccessToken(refreshToken)
}
