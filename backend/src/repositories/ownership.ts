import { getDatabase } from "../drivers/sqlite.js";

const setUserAsOwner = async (
  cid: string,
  provider: string,
  userId: string
) => {
  const db = await getDatabase();

  await db.run(
    "INSERT OR REPLACE INTO object_ownership (cid, oauth_provider, oauth_user_id, is_admin, marked_as_deleted) VALUES (?, ?, ?, ?, ?)",
    cid,
    provider,
    userId,
    false,
    null
  );
};

const setUserAsAdmin = async (
  cid: string,
  provider: string,
  userId: string
) => {
  const db = await getDatabase();

  await db.run(
    "INSERT OR REPLACE INTO object_ownership (cid, oauth_provider, oauth_user_id, is_admin, marked_as_deleted) VALUES (?, ?, ?, ?, ?)",
    cid,
    provider,
    userId,
    true,
    null
  );
};

const setObjectAsDeleted = async (
  provider: string,
  userId: string,
  cid: string
) => {
  const db = await getDatabase();

  await db.run(
    "UPDATE object_ownership SET marked_as_deleted = ? WHERE cid = ? AND oauth_provider = ? AND oauth_user_id = ?",
    new Date(),
    cid,
    provider,
    userId
  );
};

export const ownershipRepository = {
  setUserAsOwner,
  setUserAsAdmin,
  setObjectAsDeleted,
};
