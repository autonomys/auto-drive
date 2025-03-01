import { getDatabase } from '../drivers/pg.js'
import { UserRole } from '@auto-drive/models'

export interface User {
  oauth_provider: string
  oauth_user_id: string
  role: UserRole
  public_id: string
}

const getUserByPublicId = async (publicId: string): Promise<User | null> => {
  const db = await getDatabase()
  const user = await db.query(
    'SELECT * FROM users.users WHERE public_id = $1',
    [publicId],
  )

  return user.rows.at(0) ?? null
}

const getUserByOAuthInformation = async (
  oauth_provider: string,
  oauth_user_id: string,
): Promise<User | undefined> => {
  const db = await getDatabase()

  const user = await db.query(
    'SELECT * FROM users.users WHERE oauth_provider = $1 AND oauth_user_id = $2',
    [oauth_provider, oauth_user_id],
  )

  return user.rows.at(0)
}

const createUser = async (
  oauth_provider: string,
  oauth_user_id: string,
  publicId: string,
  role: UserRole,
): Promise<User | undefined> => {
  const db = await getDatabase()

  const user = await db.query<User>(
    'INSERT INTO users.users (oauth_provider, oauth_user_id, public_id, role) VALUES ($1, $2, $3, $4) RETURNING *',
    [oauth_provider, oauth_user_id, publicId, role],
  )

  return user.rows.at(0)
}

const searchUsersByPublicId = async (
  publicId: string,
  limit: number,
): Promise<User[]> => {
  const db = await getDatabase()

  const users = await db.query(
    'SELECT * FROM users.users WHERE publicId LIKE $1 limit $2',
    [`%${publicId}%`, limit],
  )

  return users.rows
}

const updateRole = async (
  oauth_provider: string,
  oauth_user_id: string,
  role: UserRole,
): Promise<User> => {
  const db = await getDatabase()

  const updatedUser = await db.query(
    'UPDATE users.users SET role = $1 WHERE oauth_provider = $2 AND oauth_user_id = $3 RETURNING *',
    [role, oauth_provider, oauth_user_id],
  )

  return updatedUser.rows.at(0)
}

const getAllUsers = async (): Promise<User[]> => {
  // TODO: Paginate when table gets big
  const db = await getDatabase()

  const users = await db.query('SELECT * FROM users.users')

  return users.rows
}

export const usersRepository = {
  getUserByPublicId,
  createUser,
  getUserByOAuthInformation,
  searchUsersByPublicId,
  updateRole,
  getAllUsers,
}
