import { getDatabase } from '../drivers/index.js'
import { ApiKey } from '@auto-drive/models'

type DBApiKey = {
  id: string
  name: string
  prefix: string
  secret_hash: string
  oauth_provider: string
  oauth_user_id: string
  deleted_at: Date | null
  expires_at: Date | null
  created_at: Date | null
}

const mapDBApiKeyToApiKey = (dbApiKey: DBApiKey): ApiKey => ({
  id: dbApiKey.id,
  name: dbApiKey.name,
  prefix: dbApiKey.prefix,
  secretHash: dbApiKey.secret_hash,
  oauthProvider: dbApiKey.oauth_provider,
  oauthUserId: dbApiKey.oauth_user_id,
  deletedAt: dbApiKey.deleted_at,
  expiresAt: dbApiKey.expires_at,
  createdAt: dbApiKey.created_at,
})

type CreateApiKeyParams = {
  id: string
  name: string
  prefix: string
  secretHash: string
  oauthProvider: string
  oauthUserId: string
  expiresAt: Date | null
}

const createApiKey = async ({
  id,
  name,
  prefix,
  secretHash,
  oauthProvider,
  oauthUserId,
  expiresAt,
}: CreateApiKeyParams): Promise<ApiKey> => {
  const db = await getDatabase()

  const result = await db.query<DBApiKey>(
    `INSERT INTO users.api_keys
       (id, name, prefix, secret_hash, oauth_provider, oauth_user_id, expires_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
     RETURNING *`,
    [id, name, prefix, secretHash, oauthProvider, oauthUserId, expiresAt],
  )

  return mapDBApiKeyToApiKey(result.rows[0])
}

const getApiKeyBySecretHash = async (
  secretHash: string,
): Promise<ApiKey | null> => {
  const db = await getDatabase()

  const result = await db.query<DBApiKey>(
    'SELECT * FROM users.api_keys WHERE secret_hash = $1',
    [secretHash],
  )

  return result.rows.map(mapDBApiKeyToApiKey)[0] ?? null
}

const getApiKeyById = async (id: string): Promise<ApiKey | null> => {
  const db = await getDatabase()

  const result = await db.query<DBApiKey>(
    'SELECT * FROM users.api_keys WHERE id = $1',
    [id],
  )

  return result.rows.map(mapDBApiKeyToApiKey)[0] ?? null
}

const deleteApiKey = async (id: string): Promise<void> => {
  const db = await getDatabase()

  const result = await db.query(
    'UPDATE users.api_keys SET deleted_at = $1 WHERE id = $2 AND deleted_at IS NULL',
    [new Date(), id],
  )
  if (result.rowCount === 0) {
    throw new Error('API key not found')
  }
}

const rotateApiKey = async (
  id: string,
  newSecretHash: string,
  newPrefix: string,
): Promise<ApiKey> => {
  const db = await getDatabase()

  const result = await db.query<DBApiKey>(
    `UPDATE users.api_keys
        SET secret_hash = $1,
            prefix = $2
      WHERE id = $3
        AND deleted_at IS NULL
      RETURNING *`,
    [newSecretHash, newPrefix, id],
  )
  if (result.rowCount === 0) {
    throw new Error('API key not found')
  }
  return mapDBApiKeyToApiKey(result.rows[0])
}

const getApiKeysByOAuthUser = async (
  oauthProvider: string,
  oauthUserId: string,
): Promise<ApiKey[]> => {
  const db = await getDatabase()

  const result = await db.query<DBApiKey>(
    `SELECT *
       FROM users.api_keys
      WHERE oauth_provider = $1
        AND oauth_user_id = $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC NULLS LAST, id`,
    [oauthProvider, oauthUserId],
  )

  return result.rows.map(mapDBApiKeyToApiKey)
}

export const apiKeysRepository = {
  deleteApiKey,
  createApiKey,
  getApiKeyById,
  getApiKeyBySecretHash,
  rotateApiKey,
  getApiKeysByOAuthUser,
}
