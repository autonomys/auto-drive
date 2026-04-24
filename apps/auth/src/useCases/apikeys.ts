import { createHash, randomBytes } from 'crypto'
import { v4 } from 'uuid'
import { apiKeysRepository } from '../repositories/index.js'
import {
  User,
  ApiKey,
  ApiKeyWithoutSecret,
  CreatedApiKey,
} from '@auto-drive/models'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('useCases:apikeys')

const SECRET_PREFIX = 'ad_'
/**
 * Length of the prefix stored in clear for UI display.
 * e.g. `ad_1a2b3c4d` — 3 brand chars + 8 hex chars.
 */
const DISPLAY_PREFIX_LENGTH = SECRET_PREFIX.length + 8

const generateSecret = (): string =>
  SECRET_PREFIX + randomBytes(32).toString('hex')

const hashSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex')

const stripSecretHash = (apiKey: ApiKey): ApiKeyWithoutSecret => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { secretHash, ...rest } = apiKey
  return rest
}

type CreateApiKeyOptions = {
  name: string
  expiresAt?: Date | null
}

const validateName = (name: unknown): string => {
  if (typeof name !== 'string') {
    throw new Error('API key name is required')
  }
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new Error('API key name is required')
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
): Promise<CreatedApiKey> => {
  const name = validateName(options.name)
  const expiresAt = validateExpiresAt(options.expiresAt)

  logger.debug(
    'Creating API key "%s" for user %s:%s',
    name,
    executor.oauthProvider,
    executor.oauthUserId,
  )

  const secret = generateSecret()
  const secretHash = hashSecret(secret)
  const prefix = secret.slice(0, DISPLAY_PREFIX_LENGTH)
  const id = v4().replace(/-/g, '')

  const apiKeyObject = await apiKeysRepository.createApiKey({
    id,
    name,
    prefix,
    secretHash,
    oauthProvider: executor.oauthProvider,
    oauthUserId: executor.oauthUserId,
    expiresAt,
  })

  logger.info(
    'API key %s ("%s") created for user %s:%s',
    id,
    name,
    executor.oauthProvider,
    executor.oauthUserId,
  )

  return {
    ...stripSecretHash(apiKeyObject),
    secret,
  }
}

const getApiKeyFromSecret = async (secret: string): Promise<ApiKey> => {
  logger.trace('Resolving API key from secret')
  const secretHash = hashSecret(secret)
  const apiKeyObject = await apiKeysRepository.getApiKeyBySecretHash(secretHash)

  if (!apiKeyObject) {
    logger.warn('API key not found for secret')
    throw new Error('Api key not found')
  }
  if (apiKeyObject.deletedAt) {
    logger.warn('API key %s has been deleted', apiKeyObject.id)
    throw new Error('Api key has been deleted')
  }
  if (apiKeyObject.expiresAt && apiKeyObject.expiresAt.getTime() <= Date.now()) {
    logger.warn('API key %s has expired at %s', apiKeyObject.id, apiKeyObject.expiresAt)
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

  await apiKeysRepository.deleteApiKey(id)
  logger.info('API key %s deleted', id)
}

const rotateApiKey = async (
  executor: User,
  id: string,
): Promise<CreatedApiKey> => {
  logger.debug(
    'Rotating API key %s by user %s:%s',
    id,
    executor.oauthProvider,
    executor.oauthUserId,
  )

  const apiKeyObject = await apiKeysRepository.getApiKeyById(id)
  if (!apiKeyObject) {
    throw new Error('Api key not found')
  }
  if (apiKeyObject.deletedAt) {
    throw new Error('Cannot rotate a deleted API key')
  }
  assertOwnership(executor, apiKeyObject)

  const secret = generateSecret()
  const secretHash = hashSecret(secret)
  const prefix = secret.slice(0, DISPLAY_PREFIX_LENGTH)

  const updated = await apiKeysRepository.rotateApiKey(id, secretHash, prefix)
  logger.info('API key %s rotated', id)

  return {
    ...stripSecretHash(updated),
    secret,
  }
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

  return apiKeys.map(stripSecretHash)
}

export const ApiKeysUseCases = {
  createApiKey,
  getApiKeyFromSecret,
  deleteApiKey,
  rotateApiKey,
  getApiKeysByUser,
}
