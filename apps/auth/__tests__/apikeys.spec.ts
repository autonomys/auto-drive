import { createHash } from 'crypto'
import { CreatedApiKey, User } from '@auto-drive/models'
import { UsersUseCases, ApiKeysUseCases } from '../src/useCases/index.js'
import { PreconditionError } from './utils/error.js'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { apiKeysRepository } from '../src/repositories/index.js'
import { ApiKeyAuth } from '../src/services/authManager/providers/apikey.js'
import { dbMigration } from './utils/dbMigrate.js'
import { MOCK_UNONBOARDED_USER } from './utils/mocks.js'

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex')

describe('ApiKeyUseCases', () => {
  let user: User
  let apiKey: CreatedApiKey

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
    const result = await UsersUseCases.onboardUser(MOCK_UNONBOARDED_USER)
    if (!result) {
      throw new PreconditionError('User not initialized')
    }
    user = result
  })

  it('should create an api key with a name and no expiry', async () => {
    apiKey = await ApiKeysUseCases.createApiKey(user, { name: 'My key' })
    expect(apiKey).toMatchObject({
      id: expect.any(String),
      secret: expect.any(String),
      name: 'My key',
      prefix: expect.any(String),
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
      expiresAt: null,
    })
    expect(apiKey.secret).toMatch(/^ad_[0-9a-f]+$/)
    expect(apiKey.prefix.length).toBeGreaterThan(0)
    expect(apiKey.secret.startsWith(apiKey.prefix)).toBe(true)
  })

  it('should reject an empty name', async () => {
    await expect(
      ApiKeysUseCases.createApiKey(user, { name: '   ' }),
    ).rejects.toThrow('API key name is required')
  })

  it('should reject an expiry in the past', async () => {
    await expect(
      ApiKeysUseCases.createApiKey(user, {
        name: 'Backdated',
        expiresAt: new Date(Date.now() - 1000),
      }),
    ).rejects.toThrow('Expiry must be in the future')
  })

  it('should be able to be authenticated', async () => {
    const authenticatedUser = await ApiKeyAuth.getUserFromApiKey(apiKey.secret)
    expect(authenticatedUser).toMatchObject({
      provider: user.oauthProvider,
      id: user.oauthUserId,
    })
  })

  it('should rotate the secret and invalidate the old one', async () => {
    const rotated = await ApiKeysUseCases.rotateApiKey(user, apiKey.id)
    expect(rotated.id).toBe(apiKey.id)
    expect(rotated.secret).not.toBe(apiKey.secret)

    // Old secret no longer works.
    await expect(ApiKeyAuth.getUserFromApiKey(apiKey.secret)).rejects.toThrow(
      'Api key not found',
    )
    // New one does.
    const authed = await ApiKeyAuth.getUserFromApiKey(rotated.secret)
    expect(authed.id).toBe(user.oauthUserId)

    apiKey = rotated
  })

  it('should reject expired keys at auth time', async () => {
    const soon = new Date(Date.now() + 100)
    const shortLived = await ApiKeysUseCases.createApiKey(user, {
      name: 'Short-lived',
      expiresAt: soon,
    })
    await new Promise((r) => setTimeout(r, 150))
    await expect(
      ApiKeyAuth.getUserFromApiKey(shortLived.secret),
    ).rejects.toThrow('Api key has expired')
  })

  it('should be able to mark as deleted an api key', async () => {
    await ApiKeysUseCases.deleteApiKey(user, apiKey.id)

    const deletedApiKey = await apiKeysRepository.getApiKeyBySecretHash(
      sha256(apiKey.secret),
    )
    expect(deletedApiKey?.deletedAt).not.toBeNull()
  })

  it('should not be able to authenticate with a deleted api key', async () => {
    await expect(ApiKeyAuth.getUserFromApiKey(apiKey.secret)).rejects.toThrow(
      'Api key has been deleted',
    )
  })

  it('should not be able to authenticate with a non existent api key', async () => {
    await expect(
      ApiKeyAuth.getUserFromApiKey('non-existent-api-key'),
    ).rejects.toThrow('Api key not found')
  })

  it('should not be able to rotate a deleted api key', async () => {
    await expect(ApiKeysUseCases.rotateApiKey(user, apiKey.id)).rejects.toThrow(
      'Cannot rotate a deleted API key',
    )
  })

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
  })
})
