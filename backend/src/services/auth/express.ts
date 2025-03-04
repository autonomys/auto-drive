import { Request, Response } from 'express'
import { UserWithOrganization } from '@auto-drive/models'
import { AuthManager } from './index.js'
import { config } from '../../config.js'

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

  const user = await AuthManager.getUserFromAccessToken(provider, accessToken)

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
  if (config.params.optionalAuth) {
    return true
  }

  return handleAuth(req, res)
}
