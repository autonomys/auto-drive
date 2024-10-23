import { getDatabase } from "../drivers/pg.js";

type Ownership = {
  cid: string;
  oauth_provider: string;
  oauth_user_id: string;
  is_admin: boolean;
  marked_as_deleted: Date | null;
};

const setUserAsOwner = async (
  cid: string,
  provider: string,
  userId: string
): Promise<void> => {
  const db = await getDatabase();

  await db.query<Ownership>({
    text: "INSERT INTO object_ownership (cid, oauth_provider, oauth_user_id, is_admin, marked_as_deleted) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid, oauth_provider, oauth_user_id) DO UPDATE SET is_admin = EXCLUDED.is_admin, marked_as_deleted = EXCLUDED.marked_as_deleted",
    values: [cid, provider, userId, false, null],
  });
};

const setUserAsAdmin = async (
  cid: string,
  provider: string,
  userId: string
): Promise<void> => {
  const db = await getDatabase();

  await db.query<Ownership>({
    text: "INSERT INTO object_ownership (cid, oauth_provider, oauth_user_id, is_admin, marked_as_deleted) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid, oauth_provider, oauth_user_id) DO UPDATE SET is_admin = EXCLUDED.is_admin, marked_as_deleted = EXCLUDED.marked_as_deleted",
    values: [cid, provider, userId, true, null],
  });
};

const updateDeletedAt = async (
  provider: string,
  userId: string,
  cid: string,
  markedAsDeleted: Date | null
): Promise<void> => {
  const db = await getDatabase();

  await db.query({
    text: "UPDATE object_ownership SET marked_as_deleted = $1 WHERE cid = $2 AND oauth_provider = $3 AND oauth_user_id = $4",
    values: [markedAsDeleted, cid, provider, userId],
  });
};

const getOwnerships = async (cid: string): Promise<Ownership[]> => {
  const db = await getDatabase();

  const result = await db.query<Ownership>({
    text: "SELECT * FROM object_ownership WHERE cid = $1 AND marked_as_deleted IS NULL",
    values: [cid],
  });

  return result.rows;
};

const getAdmins = async (cid: string): Promise<Ownership[]> => {
  const db = await getDatabase();

  const result = await db.query<Ownership>({
    text: "SELECT * FROM object_ownership WHERE cid = $1 AND is_admin = true",
    values: [cid],
  });

  return result.rows;
};

export const ownershipRepository = {
  setUserAsOwner,
  setUserAsAdmin,
  updateDeletedAt,
  getOwnerships,
  getAdmins,
};
