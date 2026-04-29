import { v4 } from 'uuid'
import { apiKeysRepository } from '../repositories/index.js'
import { User, ApiKey, ApiKeyWithoutSecret } from '@auto-drive/models'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('useCases:apikeys')

const generateSecret = (): string => v4().replace(/-/g, '')

const maskSecret = (secret: string): string => {
  if (secret.length <= 6) return '••••••'
  return `${secret.slice(0, 3)}${'•'.repeat(secret.length - 6)}${secret.slice(-3)}`
}

const stripSecret = (apiKey: ApiKey): ApiKeyWithoutSecret => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { secret, ...rest } = apiKey
  return {
    ...rest,
    maskedSecret: maskSecret(secret),
  }
}

type CreateApiKeyOptions = {
  name?: string | null
  expiresAt?: Date | null
}

/**
 * Name is optional; null/undefined/empty become NULL. When provided we
 * still enforce a sensible max length so the UI doesn't have to worry
 * about layout blow-up.
 */
const validateName = (name: unknown): string | null => {
  if (name === null || name === undefined) {
    return null
  }
  if (typeof name !== 'string') {
    throw new Error('API key name must be a string')
  }
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (trimmed.length > 64) {
    throw new Error('API key name must be 64 characters or fewer')
  }
  return trimmed
}

const validateExpiresAt = (
  expiresAt: Date | null | undefined,
): Date | null => {
  if (expiresAt === null || expiresAt === undefined) {
    return null
  }
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new Error('Invalid expiresAt value')
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error('Expiry must be in the future')
  }
  return expiresAt
}

const createApiKey = async (
  executor: User,
  options: CreateApiKeyOptions,
): Promise<ApiKey> => {
  const name = validateName(options.name)
  const expiresAt = validateExpiresAt(options.expiresAt)

  logger.debug(
    'Creating API key "%s" for user %s:%s',
    name ?? '(unnamed)',
    executor.oauthProvider,
    executor.oauthUserId,
  )

  const secret = generateSecret()
  const id = v4().replace(/-/g, '')

  const apiKeyObject = await apiKeysRepository.createApiKey({
    id,
    name,
    secret,
    oauthProvider: executor.oauthProvider,
    oauthUserId: executor.oauthUserId,
    expiresAt,
  })

  logger.info(
    'API key %s ("%s") created for user %s:%s',
    id,
    name ?? '(unnamed)',
    executor.oauthProvider,
    executor.oauthUserId,
  )

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
  if (
    apiKeyObject.expiresAt &&
    apiKeyObject.expiresAt.getTime() <= Date.now()
  ) {
    logger.warn(
      'API key %s has expired at %s',
      apiKeyObject.id,
      apiKeyObject.expiresAt,
    )
    throw new Error('Api key has expired')
  }

  return apiKeyObject
}

const assertOwnership = (executor: User, apiKey: ApiKey) => {
  if (
    apiKey.oauthProvider !== executor.oauthProvider ||
    apiKey.oauthUserId !== executor.oauthUserId
  ) {
    throw new Error('User is not the owner of the API key')
  }
}

const deleteApiKey = async (executor: User, id: string): Promise<void> => {
  logger.debug(
    'Deleting API key %s by user %s:%s',
    id,
    executor.oauthProvider,
    executor.oauthUserId,
  )
  const apiKeyObject = await apiKeysRepository.getApiKeyById(id)
  if (!apiKeyObject) {
    logger.warn('API key not found: %s', id)
    throw new Error('Api key not found')
  }
  assertOwnership(executor, apiKeyObject)

  if (apiKeyObject.deletedAt) {
    logger.warn('API key %s is already deleted', id)
    throw new Error('Api key has already been deleted')
  }

  await apiKeysRepository.deleteApiKey(id)
  logger.info('API key %s deleted', id)
}

const getApiKeysByUser = async (
  user: User,
): Promise<ApiKeyWithoutSecret[]> => {
  logger.trace(
    'Listing API keys for user %s:%s',
    user.oauthProvider,
    user.oauthUserId,
  )
  const apiKeys = await apiKeysRepository.getApiKeysByOAuthUser(
    user.oauthProvider,
    user.oauthUserId,
  )

  return apiKeys.map(stripSecret)
}

export const ApiKeysUseCases = {
  createApiKey,
  getApiKeyFromSecret,
  deleteApiKey,
  getApiKeysByUser,
}
