import { getDatabase } from "../drivers/pg.js";

const setUserAsOwner = async (
  cid: string,
  provider: string,
  userId: string
) => {
  const db = await getDatabase();

  await db.query({
    text: "INSERT INTO object_ownership (cid, oauth_provider, oauth_user_id, is_admin, marked_as_deleted) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid, oauth_provider, oauth_user_id) DO UPDATE SET is_admin = EXCLUDED.is_admin, marked_as_deleted = EXCLUDED.marked_as_deleted",
    values: [cid, provider, userId, false, null],
  });
};

const setUserAsAdmin = async (
  cid: string,
  provider: string,
  userId: string
) => {
  const db = await getDatabase();

  await db.query({
    text: "INSERT INTO object_ownership (cid, oauth_provider, oauth_user_id, is_admin, marked_as_deleted) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid, oauth_provider, oauth_user_id) DO UPDATE SET is_admin = EXCLUDED.is_admin, marked_as_deleted = EXCLUDED.marked_as_deleted",
    values: [cid, provider, userId, true, null],
  });
};

const setObjectAsDeleted = async (
  provider: string,
  userId: string,
  cid: string
) => {
  const db = await getDatabase();

  await db.query({
    text: "UPDATE object_ownership SET marked_as_deleted = $1 WHERE cid = $2 AND oauth_provider = $3 AND oauth_user_id = $4",
    values: [new Date(), cid, provider, userId],
  });
};

export const ownershipRepository = {
  setUserAsOwner,
  setUserAsAdmin,
  setObjectAsDeleted,
};
