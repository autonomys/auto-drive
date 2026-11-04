import pg from 'pg'
import { getDatabase } from '../drivers/pg.js'

type DBOrganizationMember = {
  oauth_provider: string
  oauth_user_id: string
  organization_id: string
}

const getOrganizationMemberships = async (
  organizationId: string,
): Promise<DBOrganizationMember[]> => {
  const db = await getDatabase()
  return db
    .query<DBOrganizationMember>(
      'SELECT * FROM users.users_organizations WHERE organization_id = $1',
      [organizationId],
    )
    .then((result) => result.rows)
}

// A user has at most one membership (users_organizations_user_key).
const getOrganizationMembershipByUser = async (
  oauthProvider: string,
  oauthUserId: string,
): Promise<DBOrganizationMember | null> => {
  const db = await getDatabase()
  return db
    .query<DBOrganizationMember>(
      'SELECT * FROM users.users_organizations WHERE oauth_provider = $1 AND oauth_user_id = $2',
      [oauthProvider, oauthUserId],
    )
    .then((result) => result.rows[0] ?? null)
}

const addMemberToOrganization = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string,
  db?: pg.Client,
): Promise<DBOrganizationMember> => {
  const client = db ?? (await getDatabase())
  return client
    .query<DBOrganizationMember>(
      'INSERT INTO users.users_organizations (oauth_provider, oauth_user_id, organization_id) VALUES ($1, $2, $3) RETURNING *',
      [oauthProvider, oauthUserId, organizationId],
    )
    .then((result) => result.rows[0])
}

const getOrganizationMembershipsByUsers = async (
  users: Array<{ oauthProvider: string; oauthUserId: string }>,
): Promise<DBOrganizationMember[]> => {
  if (users.length === 0) return []

  const db = await getDatabase()
  const keys = users.map((u) => `${u.oauthProvider}:${u.oauthUserId}`)

  // The first two conditions use users_organizations_user_key. They also match
  // a provider of one user paired with the ID of another; the third keeps
  // only the exact pairs.
  const result = await db.query<DBOrganizationMember>(
    `SELECT * FROM users.users_organizations
     WHERE oauth_provider = ANY($1::text[])
       AND oauth_user_id = ANY($2::text[])
       AND (oauth_provider || ':' || oauth_user_id) = ANY($3::text[])`,
    [users.map((u) => u.oauthProvider), users.map((u) => u.oauthUserId), keys],
  )

  return result.rows
}

const removeUserMemberships = async (
  oauthProvider: string,
  oauthUserId: string,
): Promise<void> => {
  const db = await getDatabase()
  await db.query(
    'DELETE FROM users.users_organizations WHERE oauth_provider = $1 AND oauth_user_id = $2',
    [oauthProvider, oauthUserId],
  )
}

export const organizationMembersRepository = {
  getOrganizationMemberships,
  getOrganizationMembershipByUser,
  getOrganizationMembershipsByUsers,
  addMemberToOrganization,
  removeUserMemberships,
}
