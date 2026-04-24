import { ApiKey, User } from '@auto-drive/models'
import { UsersUseCases, ApiKeysUseCases } from '../src/useCases/index.js'
import { PreconditionError } from './utils/error.js'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { apiKeysRepository } from '../src/repositories/index.js'
import { ApiKeyAuth } from '../src/services/authManager/providers/apikey.js'
import { dbMigration } from './utils/dbMigrate.js'
import { MOCK_UNONBOARDED_USER } from './utils/mocks.js'

describe('ApiKeyUseCases', () => {
  let user: User
  let apiKey: ApiKey

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
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
      expiresAt: null,
    })
    expect(apiKey.secret.length).toBeGreaterThan(0)
  })

  it('should create an unnamed api key when no name is supplied', async () => {
    const nameless = await ApiKeysUseCases.createApiKey(user, {})
    expect(nameless.name).toBeNull()
    await ApiKeysUseCases.deleteApiKey(user, nameless.id)
  })

  it('should coerce whitespace-only names to null', async () => {
    const blank = await ApiKeysUseCases.createApiKey(user, { name: '   ' })
    expect(blank.name).toBeNull()
    await ApiKeysUseCases.deleteApiKey(user, blank.id)
  })

  it('should reject names longer than 64 characters', async () => {
    await expect(
      ApiKeysUseCases.createApiKey(user, { name: 'x'.repeat(65) }),
    ).rejects.toThrow('API key name must be 64 characters or fewer')
  })

  it('should reject an expiry in the past', async () => {
    await expect(
      ApiKeysUseCases.createApiKey(user, {
        name: 'Backdated',
        expiresAt: new Date(Date.now() - 1000),
      }),
    ).rejects.toThrow('Expiry must be in the future')
  })

  it('should expose a prefix but no secret in list responses', async () => {
    const [listed] = await ApiKeysUseCases.getApiKeysByUser(user)
    expect(listed.name).toBe('My key')
    expect(listed.prefix.length).toBeGreaterThan(0)
    expect(apiKey.secret.startsWith(listed.prefix)).toBe(true)
    expect(
      (listed as unknown as { secret?: string }).secret,
    ).toBeUndefined()
  })

  it('should be able to be authenticated', async () => {
    const authenticatedUser = await ApiKeyAuth.getUserFromApiKey(apiKey.secret)
    expect(authenticatedUser).toMatchObject({
      provider: user.oauthProvider,
      id: user.oauthUserId,
    })
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

    const deletedApiKey = await apiKeysRepository.getApiKeyBySecret(
      apiKey.secret,
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

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
  })
})
