import { getDatabase } from "../drivers/pg";

const addTokenToRegistry = async (tokenId: string) => {
  const db = await getDatabase();

  await db.query({
    text: "INSERT INTO users.jwt_token_registry (id) VALUES ($1)",
    values: [tokenId],
  });
};

const isPresentOnRegistry = async (tokenId: string) => {
  const db = await getDatabase();

  const result = await db.query({
    text: "SELECT COUNT(*) FROM users.jwt_token_registry WHERE id = $1",
    values: [tokenId],
  });

  return result.rows[0].count > 0;
};

const removeTokenFromRegistry = async (tokenId: string) => {
  const db = await getDatabase();

  await db.query({
    text: "DELETE FROM users.jwt_token_registry WHERE id = $1",
    values: [tokenId],
  });
};

export const jwtTokenRegistry = {
  addTokenToRegistry,
  isPresentOnRegistry,
  removeTokenFromRegistry,
};
