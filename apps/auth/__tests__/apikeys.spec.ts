import { APIKey, User } from '@auto-drive/models'
import { UsersUseCases, APIKeysUseCases } from '../src/useCases/index.js'
import { PreconditionError } from './utils/error.js'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { apiKeysRepository } from '../src/repositories/index.js'
import { APIKeyAuth } from '../src/services/authManager/providers/apikey.js'
import { dbMigration } from './utils/dbMigrate.js'
import { MOCK_UNONBOARDED_USER } from './utils/mocks.js'

describe('APIKeyUseCases', () => {
  let user: User
  let apiKey: APIKey

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
    const result = await UsersUseCases.onboardUser(MOCK_UNONBOARDED_USER)
    if (!result) {
      throw new PreconditionError('User not initialized')
    }
    user = result
  })

  it('should create an API key with a name and no expiry', async () => {
    apiKey = await APIKeysUseCases.createAPIKey(user, { name: 'My key' })
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

  it('should create an unnamed API key when no name is supplied', async () => {
    const nameless = await APIKeysUseCases.createAPIKey(user, {})
    expect(nameless.name).toBeNull()
    await APIKeysUseCases.deleteAPIKey(user, nameless.id)
  })

  it('should coerce whitespace-only names to null', async () => {
    const blank = await APIKeysUseCases.createAPIKey(user, { name: '   ' })
    expect(blank.name).toBeNull()
    await APIKeysUseCases.deleteAPIKey(user, blank.id)
  })

  it('should reject names longer than 64 characters', async () => {
    await expect(
      APIKeysUseCases.createAPIKey(user, { name: 'x'.repeat(65) }),
    ).rejects.toThrow('API key name must be 64 characters or fewer')
  })

  it('should reject an expiry in the past', async () => {
    await expect(
      APIKeysUseCases.createAPIKey(user, {
        name: 'Backdated',
        expiresAt: new Date(Date.now() - 1000),
      }),
    ).rejects.toThrow('Expiry must be in the future')
  })

  it('should expose a masked secret but no raw secret in list responses', async () => {
    const [listed] = await APIKeysUseCases.getAPIKeysByUser(user)
    expect(listed.name).toBe('My key')
    expect(listed.maskedSecret).toMatch(/^.{3}•+.{3}$/)
    expect(listed.maskedSecret.startsWith(apiKey.secret.slice(0, 3))).toBe(
      true,
    )
    expect(listed.maskedSecret.endsWith(apiKey.secret.slice(-3))).toBe(true)
    expect(
      (listed as unknown as { secret?: string }).secret,
    ).toBeUndefined()
  })

  it('should be able to be authenticated', async () => {
    const authenticatedUser = await APIKeyAuth.getUserFromAPIKey(apiKey.secret)
    expect(authenticatedUser).toMatchObject({
      provider: user.oauthProvider,
      id: user.oauthUserId,
    })
  })

  it('should reject expired keys at auth time', async () => {
    const soon = new Date(Date.now() + 2_000)
    const shortLived = await APIKeysUseCases.createAPIKey(user, {
      name: 'Short-lived',
      expiresAt: soon,
    })
    await new Promise((r) => setTimeout(r, 2_100))
    await expect(
      APIKeyAuth.getUserFromAPIKey(shortLived.secret),
    ).rejects.toThrow('API key has expired')
  })

  it('should be able to mark as deleted an API key', async () => {
    await APIKeysUseCases.deleteAPIKey(user, apiKey.id)

    const deletedAPIKey = await apiKeysRepository.getAPIKeyBySecret(
      apiKey.secret,
    )
    expect(deletedAPIKey?.deletedAt).not.toBeNull()
  })

  it('should give a clear error when deleting an already-deleted key', async () => {
    await expect(
      APIKeysUseCases.deleteAPIKey(user, apiKey.id),
    ).rejects.toThrow('API key has already been deleted')
  })

  it('should not be able to authenticate with a deleted API key', async () => {
    await expect(APIKeyAuth.getUserFromAPIKey(apiKey.secret)).rejects.toThrow(
      'API key has been deleted',
    )
  })

  it('should not be able to authenticate with a non existent API key', async () => {
    await expect(
      APIKeyAuth.getUserFromAPIKey('non-existent-api-key'),
    ).rejects.toThrow('API key not found')
  })

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
  })
})
