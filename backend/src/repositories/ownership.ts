import { getDatabase } from "../drivers/sqlite";

const setUserAsOwner = async (cid: string, userId: string) => {
  const db = await getDatabase();

  await db.run(
    "INSERT INTO object_ownership (cid, user_id, is_admin, marked_as_deleted) VALUES (?, ?, ?, ?)",
    cid,
    userId,
    false,
    false
  );
};

const setUserAsAdmin = async (cid: string, userId: string) => {
  const db = await getDatabase();

  await db.run(
    "INSERT INTO object_ownership (cid, user_id, is_admin, marked_as_deleted) VALUES (?, ?, ?, ?)",
    cid,
    userId,
    true,
    false
  );
};

const setObjectAsDeleted = async (userId: string, cid: string) => {
  const db = await getDatabase();

  await db.run(
    "UPDATE object_ownership SET marked_as_deleted = ? WHERE cid = ? AND user_id = ?",
    true,
    cid,
    userId
  );
};

export const ownershipRepository = {
  setUserAsOwner,
  setUserAsAdmin,
  setObjectAsDeleted,
};
