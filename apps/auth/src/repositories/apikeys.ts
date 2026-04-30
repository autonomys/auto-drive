import { getDatabase } from '../drivers/index.js'
import { APIKey } from '@auto-drive/models'

type DBAPIKey = {
  id: string
  name: string | null
  secret: string
  oauth_provider: string
  oauth_user_id: string
  deleted_at: Date | null
  expires_at: Date | null
  created_at: Date | null
}

const mapDBAPIKeyToAPIKey = (dbAPIKey: DBAPIKey): APIKey => ({
  id: dbAPIKey.id,
  name: dbAPIKey.name,
  secret: dbAPIKey.secret,
  oauthProvider: dbAPIKey.oauth_provider,
  oauthUserId: dbAPIKey.oauth_user_id,
  deletedAt: dbAPIKey.deleted_at,
  expiresAt: dbAPIKey.expires_at,
  createdAt: dbAPIKey.created_at,
})

type CreateAPIKeyParams = {
  id: string
  name: string | null
  secret: string
  oauthProvider: string
  oauthUserId: string
  expiresAt: Date | null
}

const createAPIKey = async ({
  id,
  name,
  secret,
  oauthProvider,
  oauthUserId,
  expiresAt,
}: CreateAPIKeyParams): Promise<APIKey> => {
  const db = await getDatabase()

  const result = await db.query<DBAPIKey>(
    `INSERT INTO users.api_keys
       (id, name, secret, oauth_provider, oauth_user_id, expires_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL)
     RETURNING *`,
    [id, name, secret, oauthProvider, oauthUserId, expiresAt],
  )

  return mapDBAPIKeyToAPIKey(result.rows[0])
}

const getAPIKeyBySecret = async (secret: string): Promise<APIKey | null> => {
  const db = await getDatabase()

  const result = await db.query<DBAPIKey>(
    'SELECT * FROM users.api_keys WHERE secret = $1',
    [secret],
  )

  return result.rows.map(mapDBAPIKeyToAPIKey)[0] ?? null
}

const getAPIKeyById = async (id: string): Promise<APIKey | null> => {
  const db = await getDatabase()

  const result = await db.query<DBAPIKey>(
    'SELECT * FROM users.api_keys WHERE id = $1',
    [id],
  )

  return result.rows.map(mapDBAPIKeyToAPIKey)[0] ?? null
}

const deleteAPIKey = async (id: string): Promise<void> => {
  const db = await getDatabase()

  const result = await db.query(
    'UPDATE users.api_keys SET deleted_at = $1 WHERE id = $2 AND deleted_at IS NULL',
    [new Date(), id],
  )
  if (result.rowCount === 0) {
    throw new Error('API key not found')
  }
}

const getAPIKeysByOAuthUser = async (
  oauthProvider: string,
  oauthUserId: string,
): Promise<APIKey[]> => {
  const db = await getDatabase()

  const result = await db.query<DBAPIKey>(
    `SELECT *
       FROM users.api_keys
      WHERE oauth_provider = $1
        AND oauth_user_id = $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC NULLS LAST, id`,
    [oauthProvider, oauthUserId],
  )

  return result.rows.map(mapDBAPIKeyToAPIKey)
}

export const apiKeysRepository = {
  deleteAPIKey,
  createAPIKey,
  getAPIKeyById,
  getAPIKeyBySecret,
  getAPIKeysByOAuthUser,
}
