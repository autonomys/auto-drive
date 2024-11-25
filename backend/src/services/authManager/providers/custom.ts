import jwt from 'jsonwebtoken'
import { OAuthUser } from '../../../models/users/index.js'
import { env } from '../../../utils/misc.js'
import {
  CustomAccessTokenPayload,
  CustomRefreshTokenPayload,
  CustomTokenPayload,
} from '../../../models/users/jwt.js'
import { v4 } from 'uuid'
import { jwtTokenRegistry } from '../../../repositories/users/jwt.js'

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
    id: decoded.oauthUserId,
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

const createRefreshToken = async (user: OAuthUser) => {
  const payload: CustomRefreshTokenPayload = {
    isRefreshToken: true,
    oauthProvider: user.provider,
    oauthUserId: user.id,
    id: v4(),
  }

  await jwtTokenRegistry.addTokenToRegistry(payload.id)

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '7d',
  })
}

const getIdFromRefreshToken = (refreshToken: string) => {
  const decoded = jwt.decode(refreshToken) as CustomRefreshTokenPayload
  return decoded.id
}

const createSessionTokens = async (user: OAuthUser) => {
  const refreshToken = await createRefreshToken(user)
  const refreshTokenId = getIdFromRefreshToken(refreshToken)

  const accessToken = createAccessToken(user, refreshTokenId)

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

  const isPresentOnRegistry = await jwtTokenRegistry.isPresentOnRegistry(
    decoded.id,
  )
  if (!isPresentOnRegistry) {
    throw new Error('Invalid refresh token')
  }

  return {
    provider: decoded.oauthProvider,
    id: decoded.oauthUserId,
  }
}

const refreshAccessToken = async (refreshToken: string): Promise<string> => {
  const decoded = jwt.verify(
    refreshToken,
    JWT_SECRET,
  ) as CustomRefreshTokenPayload
  if (typeof decoded === 'string') {
    throw new Error('Invalid refresh token')
  }

  const user = await getUserFromRefreshToken(refreshToken)

  return createAccessToken(user, decoded.id)
}

const invalidateRefreshToken = async (refreshOrAccessToken: string) => {
  const decoded = jwt.verify(
    refreshOrAccessToken,
    JWT_SECRET,
  ) as CustomTokenPayload
  if (typeof decoded === 'string') {
    throw new Error('Invalid refresh token')
  }
  const id = decoded.isRefreshToken ? decoded.id : decoded.refreshTokenId

  await jwtTokenRegistry.removeTokenFromRegistry(id)
}

export const CustomJWTAuth = {
  getUserFromAccessToken,
  getUserFromRefreshToken,
  createSessionTokens,
  createAccessToken,
  refreshAccessToken,
  invalidateRefreshToken,
}
