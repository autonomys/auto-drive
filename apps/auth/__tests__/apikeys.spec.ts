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

  it('should create an api key', async () => {
    apiKey = await ApiKeysUseCases.createApiKey(user)
    expect(apiKey).toMatchObject({
      id: expect.any(String),
      secret: expect.any(String),
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
    })
  })

  it('should be able to be authenticated', async () => {
    const authenticatedUser = await ApiKeyAuth.getUserFromApiKey(apiKey.secret)
    expect(authenticatedUser).toMatchObject({
      provider: user.oauthProvider,
      id: user.oauthUserId,
    })
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
