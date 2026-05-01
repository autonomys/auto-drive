import { v4 } from 'uuid'
import { apiKeysRepository } from '../repositories/index.js'
import { User, APIKey, APIKeyWithoutSecret } from '@auto-drive/models'
import { createLogger } from '../drivers/logger.js'
import {
  APIKeyValidationError,
  APIKeyNotFoundError,
  APIKeyExpiredError,
  APIKeyForbiddenError,
} from '../errors/apikeys.js'

const logger = createLogger('useCases:apikeys')

const generateSecret = (): string => v4().replace(/-/g, '')

const maskSecret = (secret: string): string => {
  if (secret.length <= 6) return '••••••'
  return `${secret.slice(0, 3)}${'•'.repeat(secret.length - 6)}${secret.slice(-3)}`
}

const stripSecret = (apiKey: APIKey): APIKeyWithoutSecret => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { secret, ...rest } = apiKey
  return {
    ...rest,
    maskedSecret: maskSecret(secret),
  }
}

type CreateAPIKeyOptions = {
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
    throw new APIKeyValidationError('API key name must be a string')
  }
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (trimmed.length > 64) {
    throw new APIKeyValidationError(
      'API key name must be 64 characters or fewer',
    )
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
    throw new APIKeyValidationError('Invalid expiresAt value')
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new APIKeyValidationError('Expiry must be in the future')
  }
  return expiresAt
}

const createAPIKey = async (
  executor: User,
  options: CreateAPIKeyOptions,
): Promise<APIKey> => {
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

  const apiKeyObject = await apiKeysRepository.createAPIKey({
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

const getAPIKeyFromSecret = async (secret: string): Promise<APIKey> => {
  logger.trace('Resolving API key from secret')
  const apiKeyObject = await apiKeysRepository.getAPIKeyBySecret(secret)

  if (!apiKeyObject) {
    logger.warn('API key not found for secret')
    throw new APIKeyNotFoundError('API key not found')
  }
  if (apiKeyObject.deletedAt) {
    logger.warn('API key %s has been deleted', apiKeyObject.id)
    throw new APIKeyNotFoundError('API key has been deleted')
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
    throw new APIKeyExpiredError()
  }

  return apiKeyObject
}

const assertOwnership = (executor: User, apiKey: APIKey) => {
  if (
    apiKey.oauthProvider !== executor.oauthProvider ||
    apiKey.oauthUserId !== executor.oauthUserId
  ) {
    throw new APIKeyForbiddenError()
  }
}

const deleteAPIKey = async (executor: User, id: string): Promise<void> => {
  logger.debug(
    'Deleting API key %s by user %s:%s',
    id,
    executor.oauthProvider,
    executor.oauthUserId,
  )
  const apiKeyObject = await apiKeysRepository.getAPIKeyById(id)
  if (!apiKeyObject) {
    logger.warn('API key not found: %s', id)
    throw new APIKeyNotFoundError()
  }
  assertOwnership(executor, apiKeyObject)

  if (apiKeyObject.deletedAt) {
    logger.warn('API key %s is already deleted', id)
    throw new APIKeyNotFoundError('API key has already been deleted')
  }

  await apiKeysRepository.deleteAPIKey(id)
  logger.info('API key %s deleted', id)
}

const getAPIKeysByUser = async (
  user: User,
): Promise<APIKeyWithoutSecret[]> => {
  logger.trace(
    'Listing API keys for user %s:%s',
    user.oauthProvider,
    user.oauthUserId,
  )
  const apiKeys = await apiKeysRepository.getAPIKeysByOAuthUser(
    user.oauthProvider,
    user.oauthUserId,
  )

  return apiKeys.map(stripSecret)
}

export const APIKeysUseCases = {
  createAPIKey,
  getAPIKeyFromSecret,
  deleteAPIKey,
  getAPIKeysByUser,
}
