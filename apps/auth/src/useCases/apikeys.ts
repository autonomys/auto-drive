import { v4 } from 'uuid'
import { apiKeysRepository } from '../repositories/index.js'
import { User, ApiKey, ApiKeyWithoutSecret } from '@auto-drive/models'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('useCases:apikeys')

const createApiKey = async (executor: User): Promise<ApiKey> => {
  logger.debug('Creating API key for user %s:%s', executor.oauthProvider, executor.oauthUserId)
  const secret = v4({}).replace(/-/g, '')
  const id = v4().replace(/-/g, '')

  const apiKeyObject = await apiKeysRepository.createApiKey(
    id,
    secret,
    executor.oauthProvider,
    executor.oauthUserId,
  )

  logger.info('API key %s created for user %s:%s', id, executor.oauthProvider, executor.oauthUserId)

  return apiKeyObject
}

const getApiKeyFromSecret = async (secret: string): Promise<ApiKey> => {
  logger.trace('Resolving API key from secret')
  const apiKeyObject = await apiKeysRepository.getApiKeyBySecret(secret)

  if (!apiKeyObject) {
    logger.warn('API key not found for secret')
    throw new Error('Api key not found')
  }
  if (apiKeyObject.deletedAt) {
    logger.warn('API key %s has been deleted', apiKeyObject.id)
    throw new Error('Api key has been deleted')
  }

  return apiKeyObject
}

const deleteApiKey = async (executor: User, id: string): Promise<void> => {
  logger.debug('Deleting API key %s by user %s:%s', id, executor.oauthProvider, executor.oauthUserId)
  const apiKeyObject = await apiKeysRepository.getApiKeyById(id)
  if (!apiKeyObject) {
    logger.warn('API key not found: %s', id)
    throw new Error('Api key not found')
  }

  if (
    apiKeyObject.oauthProvider !== executor.oauthProvider ||
    apiKeyObject.oauthUserId !== executor.oauthUserId
  ) {
    throw new Error('User is not the owner of the API key')
  }

  await apiKeysRepository.deleteApiKey(id)
  logger.info('API key %s deleted', id)
}

const getApiKeysByUser = async (user: User): Promise<ApiKeyWithoutSecret[]> => {
  logger.trace('Listing API keys for user %s:%s', user.oauthProvider, user.oauthUserId)
  const apiKeys = await apiKeysRepository.getApiKeysByOAuthUser(
    user.oauthProvider,
    user.oauthUserId,
  )

  return apiKeys.map((apiKey) => {
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      secret,
      ...apiKeyWithoutSecret
    } = apiKey
    return apiKeyWithoutSecret
  })
}

export const ApiKeysUseCases = {
  createApiKey,
  getApiKeyFromSecret,
  deleteApiKey,
  getApiKeysByUser,
}
