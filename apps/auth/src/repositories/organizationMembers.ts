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

// A user has at most one membership (users_organizations_user_key), and only
// in an organisation that is not archived.
const getOrganizationMembershipByUser = async (
  oauthProvider: string,
  oauthUserId: string,
): Promise<DBOrganizationMember | null> => {
  const db = await getDatabase()
  return db
    .query<DBOrganizationMember>(
      `SELECT m.* FROM users.users_organizations m
       JOIN users.organizations o ON o.id = m.organization_id
       WHERE m.oauth_provider = $1 AND m.oauth_user_id = $2
         AND o.archived_at IS NULL`,
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

const isMemberOfOrganization = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string,
): Promise<boolean> => {
  const db = await getDatabase()

  const result = await db.query<DBOrganizationMember>(
    'SELECT * FROM users.users_organizations WHERE organization_id = $1 AND oauth_provider = $2 AND oauth_user_id = $3',
    [organizationId, oauthProvider, oauthUserId],
  )

  return result.rows.length > 0
}

const getOrganizationMembershipsByUsers = async (
  users: Array<{ oauthProvider: string; oauthUserId: string }>,
): Promise<DBOrganizationMember[]> => {
  if (users.length === 0) return []

  const db = await getDatabase()
  const keys = users.map((u) => `${u.oauthProvider}:${u.oauthUserId}`)

  const result = await db.query<DBOrganizationMember>(
    `SELECT m.* FROM users.users_organizations m
     JOIN users.organizations o ON o.id = m.organization_id
     WHERE (m.oauth_provider || ':' || m.oauth_user_id) = ANY($1::text[])
       AND o.archived_at IS NULL`,
    [keys],
  )

  return result.rows
}

const removeMemberFromOrganization = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string,
): Promise<void> => {
  const db = await getDatabase()
  await db.query(
    'DELETE FROM users.users_organizations WHERE organization_id = $1 AND oauth_provider = $2 AND oauth_user_id = $3',
    [organizationId, oauthProvider, oauthUserId],
  )
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
  removeMemberFromOrganization,
  removeUserMemberships,
  isMemberOfOrganization,
}
