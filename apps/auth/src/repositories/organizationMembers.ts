import pg from 'pg'
import { OrganizationRole } from '@auto-drive/models'
import { getDatabase } from '../drivers/pg.js'

type DBOrganizationMember = {
  oauth_provider: string
  oauth_user_id: string
  organization_id: string
  role: OrganizationRole
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
  role: OrganizationRole,
  db?: pg.Client,
): Promise<DBOrganizationMember> => {
  const client = db ?? (await getDatabase())
  return client
    .query<DBOrganizationMember>(
      'INSERT INTO users.users_organizations (oauth_provider, oauth_user_id, organization_id, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [oauthProvider, oauthUserId, organizationId, role],
    )
    .then((result) => result.rows[0])
}

// Returns the updated membership, or null if the user is not a member.
const updateMemberRole = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string,
  role: OrganizationRole,
  db: pg.Client,
): Promise<DBOrganizationMember | null> => {
  const result = await db.query<DBOrganizationMember>(
    `UPDATE users.users_organizations SET role = $4
     WHERE organization_id = $1 AND oauth_provider = $2 AND oauth_user_id = $3
     RETURNING *`,
    [organizationId, oauthProvider, oauthUserId, role],
  )
  return result.rows[0] ?? null
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

// Returns whether the user was a member.
const removeMemberFromOrganization = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string,
  db?: pg.Client,
): Promise<boolean> => {
  const client = db ?? (await getDatabase())
  const result = await client.query(
    'DELETE FROM users.users_organizations WHERE organization_id = $1 AND oauth_provider = $2 AND oauth_user_id = $3',
    [organizationId, oauthProvider, oauthUserId],
  )
  return (result.rowCount ?? 0) > 0
}

// Returns the organisations the user was removed from.
const removeUserMemberships = async (
  oauthProvider: string,
  oauthUserId: string,
  db?: pg.Client,
): Promise<string[]> => {
  const client = db ?? (await getDatabase())
  const result = await client.query<{ organization_id: string }>(
    'DELETE FROM users.users_organizations WHERE oauth_provider = $1 AND oauth_user_id = $2 RETURNING organization_id',
    [oauthProvider, oauthUserId],
  )
  return result.rows.map((row) => row.organization_id)
}

export const organizationMembersRepository = {
  getOrganizationMemberships,
  getOrganizationMembershipByUser,
  getOrganizationMembershipsByUsers,
  addMemberToOrganization,
  updateMemberRole,
  removeMemberFromOrganization,
  removeUserMemberships,
  isMemberOfOrganization,
}
