import jwt from 'jsonwebtoken'
import { OAuthUser } from '../../../models/users/index.js'
import { env } from '../../../utils/misc.js'

type CustomAccessTokenPayload = {
  provider: string
  id: string
}

const JWT_SECRET = env('JWT_SECRET')

const getUserFromAccessToken = async (
  accessToken: string,
): Promise<OAuthUser> => {
  const decoded = jwt.verify(
    accessToken,
    JWT_SECRET,
  ) as CustomAccessTokenPayload
  if (typeof decoded === 'string') {
    throw new Error('Invalid access token')
  }

  return {
    provider: decoded.provider,
    id: decoded.id,
  }
}

const createAccessToken = async (user: OAuthUser) => {
  const payload: CustomAccessTokenPayload = {
    provider: user.provider,
    id: user.id,
  }

  return jwt.sign(payload, 'secret', {
    expiresIn: '1h',
  })
}

const createSessionTokens = async (user: OAuthUser) => {
  const payload: CustomAccessTokenPayload = {
    provider: user.provider,
    id: user.id,
  }

  const accessToken = jwt.sign(payload, 'secret', {
    expiresIn: '1h',
  })

  const refreshToken = jwt.sign(payload, 'secret', {
    expiresIn: '7d',
  })

  return { accessToken, refreshToken }
}

const getUserFromRefreshToken = async (
  refreshToken: string,
): Promise<OAuthUser> => {
  const decoded = jwt.verify(
    refreshToken,
    JWT_SECRET,
  ) as CustomAccessTokenPayload
  if (typeof decoded === 'string') {
    throw new Error('Invalid refresh token')
  }

  return {
    provider: decoded.provider,
    id: decoded.id,
  }
}

export const CustomJWTAuth = {
  getUserFromAccessToken,
  getUserFromRefreshToken,
  createSessionTokens,
  createAccessToken,
}
