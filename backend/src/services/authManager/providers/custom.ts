import jwt from 'jsonwebtoken'
import { OAuthUser } from '../../../models/users/index.js'
import { env } from '../../../utils/misc.js'
import {
  CustomAccessTokenPayload,
  CustomRefreshTokenPayload,
} from '../../../models/users/jwt.js'
import { v4 } from 'uuid'

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
    provider: decoded.oauthProvider,
    id: decoded.id,
  }
}

const createAccessToken = (user: OAuthUser, refreshTokenId: string) => {
  const payload: CustomAccessTokenPayload = {
    id: v4(),
    isRefreshToken: false,
    oauthProvider: user.provider,
    oauthUserId: user.id,
    refreshTokenId,
  }

  return jwt.sign(payload, 'secret', {
    expiresIn: '1h',
  })
}

const createRefreshToken = (user: OAuthUser) => {
  const payload: CustomRefreshTokenPayload = {
    isRefreshToken: true,
    oauthProvider: user.provider,
    oauthUserId: user.id,
    id: v4(),
  }

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '7d',
  })
}

const createSessionTokens = async (user: OAuthUser) => {
  const refreshToken = createRefreshToken(user)
  const accessToken = createAccessToken(user, refreshToken)

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
  if (!decoded.isRefreshToken) {
    throw new Error('Invalid refresh token')
  }

  return {
    provider: decoded.oauthProvider,
    id: decoded.oauthUserId,
  }
}

const refreshAccessToken = async (refreshToken: string) => {
  const decoded = jwt.verify(
    refreshToken,
    JWT_SECRET,
  ) as CustomRefreshTokenPayload
  if (typeof decoded === 'string') {
    throw new Error('Invalid refresh token')
  }

  return createAccessToken(
    { provider: decoded.oauthProvider, id: decoded.oauthUserId },
    decoded.id,
  )
}

export const CustomJWTAuth = {
  getUserFromAccessToken,
  getUserFromRefreshToken,
  createSessionTokens,
  createAccessToken,
  refreshAccessToken,
}
