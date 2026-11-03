import pg from 'pg'
import { OrganizationRole } from '@auto-drive/models'
import { getDatabase } from '../drivers/pg.js'

type DBOrganizationMember = {
  oauth_provider: string
  oauth_user_id: string
  organization_id: string
  // NULL for memberships from before roles; see organizationRole.
  role: OrganizationRole | null
}

// Memberships from before roles are all of the user's own personal
// organisation, which they administer.
export const organizationRole = (
  member: Pick<DBOrganizationMember, 'role'>,
): OrganizationRole => member.role ?? OrganizationRole.Admin

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
}
