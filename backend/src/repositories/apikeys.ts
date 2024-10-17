import { getDatabase } from "../drivers/pg.js";

type DBApiKey = {
  api_key: string;
  user_id: string;
};

type ApiKey = {
  apiKey: string;
  userId: string;
};

const mapDBApiKeyToApiKey = (dbApiKey: DBApiKey): ApiKey => ({
  apiKey: dbApiKey.api_key,
  userId: dbApiKey.user_id,
});

const createApiKey = async (
  apiKey: string,
  userId: string
): Promise<ApiKey> => {
  const db = await getDatabase();

  const result = await db.query<DBApiKey>(
    "INSERT INTO api_keys_users (api_key, user_id) VALUES ($1, $2) RETURNING *",
    [apiKey, userId]
  );

  return mapDBApiKeyToApiKey(result.rows[0]);
};

const getApiKey = async (apiKey: string): Promise<ApiKey | null> => {
  const db = await getDatabase();

  const result = await db.query<DBApiKey>(
    "SELECT * FROM api_keys_users WHERE api_key = $1",
    [apiKey]
  );

  return result.rows.map(mapDBApiKeyToApiKey)[0] ?? null;
};

export const apiKeysRepository = {
  createApiKey,
  getApiKey,
};
