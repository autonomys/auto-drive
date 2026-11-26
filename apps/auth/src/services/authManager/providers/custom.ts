import jwt from 'jsonwebtoken'
import {
  OAuthUser,
  UserRole,
  CustomAccessTokenPayload,
  CustomRefreshTokenPayload,
  CustomTokenPayload,
  MaybeUser,
  isPartnerEndUser,
} from '@auto-drive/models'
import { v4 } from 'uuid'
import { jwtTokenRegistry } from '../../../repositories/jwt.js'
import {
  OrganizationsUseCases,
  UsersUseCases,
} from '../../../useCases/index.js'
import { config } from '../../../config.js'

const JWT_SECRET = Buffer.from(config.jwtSecret, 'base64').toString('utf-8')
const JWT_SECRET_ALGORITHM = config.jwtSecretAlgorithm as jwt.Algorithm

// Applies to access and refresh tokens alike.
const isIssuedBeforeCutoff = ({ iat }: jwt.JwtPayload) =>
  config.revokeTokenEmittedBeforeInSeconds > 0 &&
  !!iat &&
  iat < config.revokeTokenEmittedBeforeInSeconds

const getUserFromAccessToken = async (
  accessToken: string,
): Promise<OAuthUser> => {
  const decoded = jwt.verify(accessToken, JWT_SECRET, {
    algorithms: [JWT_SECRET_ALGORITHM],
  })
  if (typeof decoded === 'string') {
    throw new Error('Invalid access token')
  }

  if (isIssuedBeforeCutoff(decoded)) {
    throw new Error('Invalid access token')
  }

  if (decoded.isRefreshToken) {
    throw new Error('Invalid access token')
  }

  // A partner end user's access token has no refresh token to check, and
  // lasts until it expires.
  if (decoded.refreshTokenId !== null) {
    const isPresent = await jwtTokenRegistry.isPresentOnRegistry(
      decoded.refreshTokenId,
    )
    if (!isPresent) {
      throw new Error('Invalid access token')
    }
  }

  return {
    provider: decoded.oauthProvider,
    id: decoded.oauthUserId,
    username: decoded.oauthUsername,
    avatarUrl: decoded.oauthAvatarUrl,
  }
}

const createAccessToken = async (
  maybeUser: MaybeUser,
  refreshTokenId: string | null,
) => {
  const user = await UsersUseCases.getUserByOAuthUser({
    provider: maybeUser.oauthProvider,
    id: maybeUser.oauthUserId,
    username: maybeUser.oauthUsername,
    avatarUrl: maybeUser.oauthAvatarUrl,
  })

  const userInfo = user.onboarded
    ? await UsersUseCases.getUserWithOrganization(user)
    : null

  // Partner end users get a role of their own, which has no Hasura
  // permissions.
  const roles =
    userInfo?.onboarded && isPartnerEndUser(userInfo)
      ? ['partner_end_user']
      : user.role === UserRole.Admin
        ? ['app-admin', 'user']
        : ['user']
  const defaultRole = roles[0]

  const payload: CustomAccessTokenPayload = {
    id: v4(),
    isRefreshToken: false,
    oauthProvider: user.oauthProvider,
    oauthUserId: user.oauthUserId,
    oauthUsername: user.oauthUsername,
    oauthAvatarUrl: user.oauthAvatarUrl,
    refreshTokenId,
    'https://hasura.io/jwt/claims': {
      'x-hasura-default-role': defaultRole,
      'x-hasura-allowed-roles': roles,
      'x-hasura-oauth-provider': user.oauthProvider,
      'x-hasura-oauth-user-id': user.oauthUserId,
      'x-hasura-organization-id': userInfo?.organizationId ?? 'none',
      'x-hasura-public-id': userInfo?.publicId ?? 'none',
    },
  }

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '1h',
    algorithm: JWT_SECRET_ALGORITHM,
  })
}

const createRefreshToken = async (user: MaybeUser) => {
  const payload: CustomRefreshTokenPayload = {
    isRefreshToken: true,
    oauthProvider: user.oauthProvider,
    oauthUserId: user.oauthUserId,
    oauthUsername: user.oauthUsername,
    oauthAvatarUrl: user.oauthAvatarUrl,
    id: v4(),
  }

  await jwtTokenRegistry.addTokenToRegistry(payload.id)

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '7d',
    algorithm: JWT_SECRET_ALGORITHM,
  })
}

const getIdFromRefreshToken = (refreshToken: string) => {
  const decoded = jwt.decode(refreshToken) as CustomRefreshTokenPayload
  return decoded.id
}

// Partner end users get no refresh token: they sign in again when their
// access token expires.
const createSessionTokens = async (
  user: MaybeUser,
): Promise<{ accessToken: string; refreshToken: string | null }> => {
  if (user.onboarded && (await OrganizationsUseCases.isPartnerEndUser(user))) {
    return {
      accessToken: await createAccessToken(user, null),
      refreshToken: null,
    }
  }

  const refreshToken = await createRefreshToken(user)
  const refreshTokenId = getIdFromRefreshToken(refreshToken)

  const accessToken = await createAccessToken(user, refreshTokenId)

  return { accessToken, refreshToken }
}

const getUserFromRefreshToken = async (
  refreshToken: string,
): Promise<MaybeUser> => {
  const decoded = jwt.verify(refreshToken, JWT_SECRET, {
    algorithms: [JWT_SECRET_ALGORITHM],
  }) as CustomAccessTokenPayload
  if (typeof decoded === 'string') {
    throw new Error('Invalid refresh token')
  }
  if (!decoded.isRefreshToken) {
    throw new Error('Invalid refresh token')
  }
  if (isIssuedBeforeCutoff(decoded)) {
    throw new Error('Invalid refresh token')
  }

  const isPresentOnRegistry = await jwtTokenRegistry.isPresentOnRegistry(
    decoded.id,
  )
  if (!isPresentOnRegistry) {
    throw new Error('Invalid refresh token')
  }

  return UsersUseCases.getUserByOAuthUser({
    provider: decoded.oauthProvider,
    id: decoded.oauthUserId,
    username: decoded.oauthUsername,
    avatarUrl: decoded.oauthAvatarUrl,
  })
}

const refreshAccessToken = async (refreshToken: string): Promise<string> => {
  const decoded = jwt.verify(refreshToken, JWT_SECRET, {
    algorithms: [JWT_SECRET_ALGORITHM],
  }) as CustomRefreshTokenPayload
  if (typeof decoded === 'string') {
    throw new Error('Invalid refresh token')
  }

  const user = await getUserFromRefreshToken(refreshToken)

  return createAccessToken(user, decoded.id)
}

const invalidateRefreshToken = async (refreshOrAccessToken: string) => {
  const decoded = jwt.verify(refreshOrAccessToken, JWT_SECRET, {
    algorithms: [JWT_SECRET_ALGORITHM],
  }) as CustomTokenPayload

  if (typeof decoded === 'string') {
    throw new Error('Invalid refresh token')
  }
  const id = decoded.isRefreshToken ? decoded.id : decoded.refreshTokenId

  // A partner end user's access token has no refresh token to remove.
  if (id) {
    await jwtTokenRegistry.removeTokenFromRegistry(id)
  }
}

export const CustomJWTAuth = {
  getUserFromAccessToken,
  getUserFromRefreshToken,
  createSessionTokens,
  createAccessToken,
  refreshAccessToken,
  invalidateRefreshToken,
}
