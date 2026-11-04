import {
  CustomAccessTokenPayload,
  CustomRefreshTokenPayload,
  User,
} from '@auto-drive/models'
import { CustomJWTAuth } from '../src/services/authManager/providers/custom.js'
import jwt from 'jsonwebtoken'
import { AuthManager } from '../src/services/authManager/index.js'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { dbMigration } from './utils/dbMigrate.js'
import { createMockUser } from './utils/mocks.js'
import { config } from '../src/config.js'

describe('JWT', () => {
  let user: User

  let refreshTokenId: string
  let accessTokenString: string
  let refreshTokenString: string

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
    user = await createMockUser()
  })

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
  })

  it('should generate a JWT token', async () => {
    const token = await CustomJWTAuth.createSessionTokens(user)

    const refreshTokenDecoded = jwt.decode(token.refreshToken)
    if (typeof refreshTokenDecoded === 'string' || !refreshTokenDecoded) {
      throw new Error('Invalid refresh token')
    }
    const refreshTokenPayload = refreshTokenDecoded as CustomRefreshTokenPayload

    expect(refreshTokenPayload.oauthUserId).toBe(user.oauthUserId)
    expect(refreshTokenPayload.isRefreshToken).toBe(true)
    expect(refreshTokenPayload.id).toBeDefined()

    refreshTokenId = refreshTokenPayload.id

    const decoded = jwt.decode(token.accessToken)
    expect(decoded).toBeDefined()
    if (typeof decoded === 'string' || !decoded) {
      throw new Error('Invalid access token')
    }
    const accessTokenPayload = decoded as CustomAccessTokenPayload

    expect(accessTokenPayload.oauthProvider).toBe(user.oauthProvider)
    expect(accessTokenPayload.oauthUserId).toBe(user.oauthUserId)
    expect(accessTokenPayload.isRefreshToken).toBe(false)
    expect(accessTokenPayload.refreshTokenId).toBe(refreshTokenId)

    accessTokenString = token.accessToken
    refreshTokenString = token.refreshToken
  })

  it('should be able to authenticate with the access token', async () => {
    const user = await AuthManager.getUserFromAccessToken(
      'custom-jwt',
      accessTokenString,
    )

    expect(user).toBeDefined()
    expect(user?.id).toBe(user.id)
    expect(user?.provider).toBe(user.provider)
  })

  it('should be able to refresh with the refresh token', async () => {
    const newAccessToken =
      await CustomJWTAuth.refreshAccessToken(refreshTokenString)

    if (!newAccessToken) {
      expect(newAccessToken).not.toBeNull()
      return
    }

    const decoded = jwt.decode(newAccessToken)
    expect(decoded).toBeDefined()
    if (typeof decoded === 'string' || !decoded) {
      throw new Error('Invalid access token')
    }

    const accessTokenPayload = decoded as CustomAccessTokenPayload

    expect(accessTokenPayload.refreshTokenId).toBe(refreshTokenId)
    expect(accessTokenPayload.isRefreshToken).toBe(false)
    expect(accessTokenPayload.oauthUserId).toBe(user.oauthUserId)
    expect(accessTokenPayload.oauthProvider).toBe(user.oauthProvider)

    accessTokenString = newAccessToken
  })

  it('should not be able to refresh with the access token', async () => {
    expect(CustomJWTAuth.refreshAccessToken(accessTokenString)).rejects.toThrow(
      'Invalid refresh token',
    )
  })

  it('should be able to invalidate the refresh token', async () => {
    expect(() =>
      CustomJWTAuth.invalidateRefreshToken(refreshTokenString),
    ).not.toThrow()
  })

  it('should not be able to generate an access token after invalidating the refresh token', async () => {
    await CustomJWTAuth.invalidateRefreshToken(refreshTokenString)

    await expect(
      CustomJWTAuth.refreshAccessToken(refreshTokenString),
    ).rejects.toThrow('Invalid refresh token')
  })

  it('should reject access and refresh tokens issued before the revocation cutoff', async () => {
    const tokens = await CustomJWTAuth.createSessionTokens(user)
    const previousCutoff = config.revokeTokenEmittedBeforeInSeconds
    config.revokeTokenEmittedBeforeInSeconds =
      Math.floor(Date.now() / 1000) + 60

    try {
      await expect(
        AuthManager.getUserFromAccessToken('custom-jwt', tokens.accessToken),
      ).rejects.toThrow('Invalid access token')
      await expect(
        CustomJWTAuth.refreshAccessToken(tokens.refreshToken),
      ).rejects.toThrow('Invalid refresh token')
    } finally {
      config.revokeTokenEmittedBeforeInSeconds = previousCutoff
    }

    await expect(
      CustomJWTAuth.refreshAccessToken(tokens.refreshToken),
    ).resolves.toBeDefined()
  })

  it('should not be able to authenticate with the access token after invalidating the refresh token', async () => {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not set')
    }
    await CustomJWTAuth.invalidateRefreshToken(refreshTokenString)

    await expect(
      AuthManager.getUserFromAccessToken('custom-jwt', accessTokenString),
    ).rejects.toThrow('Invalid access token')
  })
})
