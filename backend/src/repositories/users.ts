import { getDatabase } from "../drivers/pg.js";
import { UserRole } from "../models/user.js";

export interface User {
  oauth_provider: string;
  oauth_user_id: string;
  role: UserRole;
  download_credits: number;
  upload_credits: number;
  handle: string;
}

const getUserByHandle = async (handle: string): Promise<User | null> => {
  const db = await getDatabase();
  const user = await db.query("SELECT * FROM users WHERE handle = $1", [
    handle,
  ]);

  return user.rows.at(0) ?? null;
};

const getUserByOAuthInformation = async (
  oauth_provider: string,
  oauth_user_id: string
): Promise<User | undefined> => {
  const db = await getDatabase();

  const user = await db.query(
    "SELECT * FROM users WHERE oauth_provider = $1 AND oauth_user_id = $2",
    [oauth_provider, oauth_user_id]
  );

  return user.rows.at(0);
};

const createUser = async (
  oauth_provider: string,
  oauth_user_id: string,
  handle: string,
  role: UserRole,
  download_credits: number,
  upload_credits: number
): Promise<void> => {
  const db = await getDatabase();

  await db.query(
    "INSERT INTO users (oauth_provider, oauth_user_id, handle, role, download_credits, upload_credits) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    [
      oauth_provider,
      oauth_user_id,
      handle,
      role,
      download_credits,
      upload_credits,
    ]
  );
};

const updateHandle = async (
  oauth_provider: string,
  oauth_user_id: string,
  handle: string
): Promise<User> => {
  const db = await getDatabase();

  const updatedUser = await db.query(
    "INSERT INTO users (oauth_provider, oauth_user_id, handle) VALUES ($2, $3, $1) ON CONFLICT (oauth_provider, oauth_user_id) DO UPDATE SET handle = $1 RETURNING *",
    [handle, oauth_provider, oauth_user_id]
  );

  return updatedUser.rows.at(0);
};

const searchUsersByHandle = async (
  handle: string,
  limit: number
): Promise<User[]> => {
  const db = await getDatabase();

  const users = await db.query(
    "SELECT * FROM users WHERE handle LIKE $1 limit $2",
    [`%${handle}%`, limit]
  );

  return users.rows;
};

const updateRole = async (
  oauth_provider: string,
  oauth_user_id: string,
  role: UserRole
): Promise<User> => {
  const db = await getDatabase();

  const updatedUser = await db.query(
    "UPDATE users SET role = $1 WHERE oauth_provider = $2 AND oauth_user_id = $3 RETURNING *",
    [role, oauth_provider, oauth_user_id]
  );

  return updatedUser.rows.at(0);
};

const setDownloadCredits = async (
  oauth_provider: string,
  oauth_user_id: string,
  credits: number
): Promise<User> => {
  const db = await getDatabase();

  const updatedUser = await db.query(
    "UPDATE users SET download_credits = $1 WHERE oauth_provider = $2 AND oauth_user_id = $3 RETURNING *",
    [credits, oauth_provider, oauth_user_id]
  );

  return updatedUser.rows.at(0);
};

const setUploadCredits = async (
  oauth_provider: string,
  oauth_user_id: string,
  credits: number
): Promise<User> => {
  const db = await getDatabase();

  const updatedUser = await db.query(
    "UPDATE users SET upload_credits = $1 WHERE oauth_provider = $2 AND oauth_user_id = $3 RETURNING *",
    [credits, oauth_provider, oauth_user_id]
  );

  return updatedUser.rows.at(0);
};

const subtractDownloadCredits = async (
  oauth_provider: string,
  oauth_user_id: string,
  credits: number
): Promise<User> => {
  const db = await getDatabase();

  const updatedUser = await db.query(
    "UPDATE users SET download_credits = download_credits - $1 WHERE oauth_provider = $2 AND oauth_user_id = $3 RETURNING *",
    [credits, oauth_provider, oauth_user_id]
  );

  return updatedUser.rows.at(0);
};

const subtractUploadCredits = async (
  oauth_provider: string,
  oauth_user_id: string,
  credits: number
): Promise<User> => {
  const db = await getDatabase();

  const updatedUser = await db.query(
    "UPDATE users SET upload_credits = upload_credits - $1 WHERE oauth_provider = $2 AND oauth_user_id = $3 RETURNING *",
    [credits, oauth_provider, oauth_user_id]
  );

  return updatedUser.rows.at(0);
};

const getAllUsers = async (): Promise<User[]> => {
  // TODO: Paginate when table gets big
  const db = await getDatabase();

  const users = await db.query("SELECT * FROM users");

  return users.rows;
};

export const usersRepository = {
  getUserByHandle,
  updateHandle,
  createUser,
  getUserByOAuthInformation,
  searchUsersByHandle,
  updateRole,
  setDownloadCredits,
  setUploadCredits,
  subtractDownloadCredits,
  subtractUploadCredits,
  getAllUsers,
};
