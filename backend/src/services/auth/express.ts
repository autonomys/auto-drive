import { Request } from 'express'
import { UserWithOrganization } from '@auto-drive/models'
import { AuthManager } from './index.js'
import { config } from '../../config.js'
import { exhaustiveCheck } from '../../utils/misc.js'

export enum AuthType {
  Auth = 'auth',
  OptionalAuth = 'optionalAuth',
}

export const handleAuth = async (
  req: Request,
): Promise<UserWithOrganization | null> => {
  const accessToken = req.headers.authorization?.split(' ')[1]
  if (!accessToken) {
    return null
  }

  const provider = req.headers['x-auth-provider']
  if (typeof provider !== 'string') {
    return null
  }

  const user = await AuthManager.getUserFromAccessToken(provider, accessToken)

  if (!user) {
    return null
  }

  return user
}

export const handleOptionalAuth = async (
  req: Request,
): Promise<UserWithOrganization | boolean | null> => {
  if (config.params.optionalAuth) {
    return true
  }

  return handleAuth(req)
}

export const expressAuthentication = async (
  request: Request,
  securityName: AuthType,
): Promise<UserWithOrganization | boolean | null> => {
  if (securityName === AuthType.Auth) {
    return handleAuth(request)
  } else if (securityName === AuthType.OptionalAuth) {
    return handleOptionalAuth(request)
  } else {
    return exhaustiveCheck(securityName)
  }
}
