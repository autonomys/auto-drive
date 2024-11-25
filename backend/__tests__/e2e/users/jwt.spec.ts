import {
  CustomAccessTokenPayload,
  CustomRefreshTokenPayload,
} from '../../../src/models/users/jwt'
import { CustomJWTAuth } from '../../../src/services/authManager/providers/custom'
import jwt from 'jsonwebtoken'
import { AuthManager } from '../../../src/services/authManager'
import { closeDatabase, getDatabase } from '../../../src/drivers/pg'
import { dbMigration } from '../../utils/dbMigrate'

describe('JWT', () => {
  const provider = 'custom'
  const userId = '123'

  let refreshTokenId: string
  let accessTokenString: string
  let refreshTokenString: string

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
  })

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
  })

  it('should generate a JWT token', async () => {
    const token = await CustomJWTAuth.createSessionTokens({
      id: userId,
      provider,
    })

    const refreshTokenDecoded = jwt.decode(token.refreshToken)
    if (typeof refreshTokenDecoded === 'string' || !refreshTokenDecoded) {
      throw new Error('Invalid refresh token')
    }
    const refreshTokenPayload = refreshTokenDecoded as CustomRefreshTokenPayload

    expect(refreshTokenPayload.oauthUserId).toBe(userId)
    expect(refreshTokenPayload.isRefreshToken).toBe(true)
    expect(refreshTokenPayload.id).toBeDefined()

    refreshTokenId = refreshTokenPayload.id

    const decoded = jwt.decode(token.accessToken)
    expect(decoded).toBeDefined()
    if (typeof decoded === 'string' || !decoded) {
      throw new Error('Invalid access token')
    }
    const accessTokenPayload = decoded as CustomAccessTokenPayload

    expect(accessTokenPayload.oauthProvider).toBe(provider)
    expect(accessTokenPayload.oauthUserId).toBe(userId)
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
    expect(user?.id).toBe(userId)
    expect(user?.provider).toBe(provider)
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
    expect(accessTokenPayload.oauthUserId).toBe(userId)
    expect(accessTokenPayload.oauthProvider).toBe(provider)

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
})
