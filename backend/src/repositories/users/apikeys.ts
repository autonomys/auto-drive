import { getDatabase } from "../../drivers/pg.js";
import { ApiKey } from "../../models/users/apiKey.js";

type DBApiKey = {
  id: string;
  secret: string;
  oauth_provider: string;
  oauth_user_id: string;
  deleted_at: Date | null;
};

const mapDBApiKeyToApiKey = (dbApiKey: DBApiKey): ApiKey => ({
  id: dbApiKey.id,
  secret: dbApiKey.secret,
  oauthProvider: dbApiKey.oauth_provider,
  oauthUserId: dbApiKey.oauth_user_id,
  deletedAt: dbApiKey.deleted_at,
});

const createApiKey = async (
  id: string,
  secret: string,
  oauthProvider: string,
  oauthUserId: string
): Promise<ApiKey> => {
  const db = await getDatabase();

  const result = await db.query<DBApiKey>(
    "INSERT INTO api_keys (id, secret, oauth_provider, oauth_user_id, deleted_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [id, secret, oauthProvider, oauthUserId, null]
  );

  return mapDBApiKeyToApiKey(result.rows[0]);
};

const getApiKeyBySecret = async (secret: string): Promise<ApiKey | null> => {
  const db = await getDatabase();

  const result = await db.query<DBApiKey>(
    "SELECT * FROM api_keys WHERE secret = $1",
    [secret]
  );

  return result.rows.map(mapDBApiKeyToApiKey)[0] ?? null;
};

const getApiKeyById = async (id: string): Promise<ApiKey | null> => {
  const db = await getDatabase();

  const result = await db.query<DBApiKey>(
    "SELECT * FROM api_keys WHERE id = $1",
    [id]
  );

  return result.rows.map(mapDBApiKeyToApiKey)[0] ?? null;
};
const deleteApiKey = async (id: string): Promise<void> => {
  const db = await getDatabase();

  const result = await db.query(
    "UPDATE api_keys SET deleted_at = $1 WHERE id = $2",
    [new Date(), id]
  );
  console.log("API key matched with: ", result.rowCount);
  if (result.rowCount === 0) {
    throw new Error("API key not found");
  }
};

const getApiKeysByOAuthUser = async (
  oauthProvider: string,
  oauthUserId: string
): Promise<ApiKey[]> => {
  const db = await getDatabase();

  const result = await db.query<DBApiKey>(
    "SELECT * FROM api_keys WHERE oauth_provider = $1 AND oauth_user_id = $2",
    [oauthProvider, oauthUserId]
  );

  return result.rows.map(mapDBApiKeyToApiKey);
};

export const apiKeysRepository = {
  deleteApiKey,
  createApiKey,
  getApiKeyById,
  getApiKeyBySecret,
  getApiKeysByOAuthUser,
};
