import pg from 'pg'
import { OrganizationRole, SERVICE_USER_PROVIDER } from '@auto-drive/models'
import { getDatabase } from '../drivers/pg.js'

export type DBOrganizationMember = {
  oauth_provider: string
  oauth_user_id: string
  organization_id: string
  // NULL for memberships from before roles; see organizationRole.
  role: OrganizationRole | null
  // Nullable, but every insert takes the column default.
  created_at: Date
  // The partner end user columns, NULL for everyone else. A removed end user
  // keeps the row with end_user_removed_at set.
  customer_reference: string | null
  // A bigint, which pg returns as a string.
  upload_quota_bytes: string | null
  end_user_removed_at: Date | null
  // Set, with end_user_removed_at, once the end user closed their account.
  end_user_closed_at: Date | null
}

// Memberships from before roles are all of the user's own personal
// organisation, which they administer.
export const organizationRole = (
  member: Pick<DBOrganizationMember, 'role'>,
): OrganizationRole => member.role ?? OrganizationRole.Admin

export const uploadQuotaBytes = (
  member: Pick<DBOrganizationMember, 'upload_quota_bytes'>,
): number | null =>
  member.upload_quota_bytes === null ? null : Number(member.upload_quota_bytes)

// The people in an organisation: its service user, which only holds its API
// keys, and its partner end users, who are its customers, are left out.
const getOrganizationMemberships = async (
  organizationId: string,
): Promise<DBOrganizationMember[]> => {
  const db = await getDatabase()
  return db
    .query<DBOrganizationMember>(
      `SELECT * FROM users.users_organizations
       WHERE organization_id = $1 AND oauth_provider <> $2
         AND role IS DISTINCT FROM $3`,
      [organizationId, SERVICE_USER_PROVIDER, OrganizationRole.PartnerEndUser],
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
  db?: pg.Client,
): Promise<DBOrganizationMember[]> => {
  if (users.length === 0) return []

  const client = db ?? (await getDatabase())
  const keys = users.map((u) => `${u.oauthProvider}:${u.oauthUserId}`)

  // The first two conditions use users_organizations_user_key. They also match
  // a provider of one user paired with the ID of another; the third keeps
  // only the exact pairs.
  const result = await client.query<DBOrganizationMember>(
    `SELECT * FROM users.users_organizations
     WHERE oauth_provider = ANY($1::text[])
       AND oauth_user_id = ANY($2::text[])
       AND (oauth_provider || ':' || oauth_user_id) = ANY($3::text[])`,
    [users.map((u) => u.oauthProvider), users.map((u) => u.oauthUserId), keys],
  )

  return result.rows
}

// Returns the removed membership, or null if the user was not a member.
const removeMemberFromOrganization = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string,
  db?: pg.Client,
): Promise<DBOrganizationMember | null> => {
  const client = db ?? (await getDatabase())
  const result = await client.query<DBOrganizationMember>(
    'DELETE FROM users.users_organizations WHERE organization_id = $1 AND oauth_provider = $2 AND oauth_user_id = $3 RETURNING *',
    [organizationId, oauthProvider, oauthUserId],
  )
  return result.rows[0] ?? null
}

// Returns the memberships the user was removed from.
const removeUserMemberships = async (
  oauthProvider: string,
  oauthUserId: string,
  db?: pg.Client,
): Promise<DBOrganizationMember[]> => {
  const client = db ?? (await getDatabase())
  const result = await client.query<DBOrganizationMember>(
    'DELETE FROM users.users_organizations WHERE oauth_provider = $1 AND oauth_user_id = $2 RETURNING *',
    [oauthProvider, oauthUserId],
  )
  return result.rows
}

// A partner organisation's end users with any of these customer references,
// removed or not.
const getEndUsersByCustomerReferences = async (
  organizationId: string,
  customerReferences: string[],
  db: pg.Client,
): Promise<DBOrganizationMember[]> => {
  const result = await db.query<DBOrganizationMember>(
    `SELECT * FROM users.users_organizations
     WHERE organization_id = $1 AND customer_reference = ANY($2::text[])`,
    [organizationId, customerReferences],
  )
  return result.rows
}

// The end users the partner has not removed.
const countActiveEndUsers = async (
  organizationId: string,
  db: pg.Client,
): Promise<number> => {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users.users_organizations
     WHERE organization_id = $1 AND role = $2 AND end_user_removed_at IS NULL`,
    [organizationId, OrganizationRole.PartnerEndUser],
  )
  return Number(result.rows[0].count)
}

// Whether the organisation has any end users, removed ones included.
const hasEndUsers = async (
  organizationId: string,
  db: pg.Client,
): Promise<boolean> => {
  const result = await db.query(
    `SELECT 1 FROM users.users_organizations
     WHERE organization_id = $1 AND role = $2
     LIMIT 1`,
    [organizationId, OrganizationRole.PartnerEndUser],
  )
  return result.rows.length > 0
}

const addEndUser = async (
  organizationId: string,
  endUser: {
    oauthProvider: string
    oauthUserId: string
    customerReference: string
    uploadQuotaBytes: number | null
  },
  db: pg.Client,
): Promise<DBOrganizationMember> => {
  const result = await db.query<DBOrganizationMember>(
    `INSERT INTO users.users_organizations
       (oauth_provider, oauth_user_id, organization_id, role,
        customer_reference, upload_quota_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      endUser.oauthProvider,
      endUser.oauthUserId,
      organizationId,
      OrganizationRole.PartnerEndUser,
      endUser.customerReference,
      endUser.uploadQuotaBytes,
    ],
  )
  return result.rows[0]
}

// Enrols a removed end user again, or one who closed their account, with the
// quota the partner now gives. Their customer reference never changes.
const reenrollEndUser = async (
  organizationId: string,
  endUser: {
    oauthProvider: string
    oauthUserId: string
    uploadQuotaBytes: number | null
  },
  db: pg.Client,
): Promise<DBOrganizationMember> => {
  const result = await db.query<DBOrganizationMember>(
    `UPDATE users.users_organizations
     SET end_user_removed_at = NULL, end_user_closed_at = NULL,
         upload_quota_bytes = $4
     WHERE organization_id = $1 AND oauth_provider = $2 AND oauth_user_id = $3
       AND role = $5
     RETURNING *`,
    [
      organizationId,
      endUser.oauthProvider,
      endUser.oauthUserId,
      endUser.uploadQuotaBytes,
      OrganizationRole.PartnerEndUser,
    ],
  )
  return result.rows[0]
}

// The user's membership of the organisation, read FOR UPDATE so a concurrent
// change to it doesn't overlap (see getOrganizationForUpdate).
const getMembershipForUpdate = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string,
  db: pg.Client,
): Promise<DBOrganizationMember | null> => {
  const result = await db.query<DBOrganizationMember>(
    `SELECT * FROM users.users_organizations
     WHERE organization_id = $1 AND oauth_provider = $2 AND oauth_user_id = $3
     FOR UPDATE`,
    [organizationId, oauthProvider, oauthUserId],
  )
  return result.rows[0] ?? null
}

const markEndUserRemoved = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string,
  db: pg.Client,
): Promise<void> => {
  await db.query(
    `UPDATE users.users_organizations SET end_user_removed_at = NOW()
     WHERE organization_id = $1 AND oauth_provider = $2 AND oauth_user_id = $3
       AND role = $4`,
    [
      organizationId,
      oauthProvider,
      oauthUserId,
      OrganizationRole.PartnerEndUser,
    ],
  )
}

const setEndUserQuota = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string,
  uploadQuotaBytes: number | null,
  db: pg.Client,
): Promise<DBOrganizationMember> => {
  const result = await db.query<DBOrganizationMember>(
    `UPDATE users.users_organizations SET upload_quota_bytes = $4
     WHERE organization_id = $1 AND oauth_provider = $2 AND oauth_user_id = $3
       AND role = $5
     RETURNING *`,
    [
      organizationId,
      oauthProvider,
      oauthUserId,
      uploadQuotaBytes,
      OrganizationRole.PartnerEndUser,
    ],
  )
  return result.rows[0]
}

// Marks the user's end-user membership, if they have one, as closed and
// removed, keeping the row.
const closeEndUserMembership = async (
  oauthProvider: string,
  oauthUserId: string,
  db: pg.Client,
): Promise<DBOrganizationMember | null> => {
  const result = await db.query<DBOrganizationMember>(
    `UPDATE users.users_organizations
     SET end_user_removed_at = COALESCE(end_user_removed_at, NOW()),
         end_user_closed_at = NOW()
     WHERE oauth_provider = $1 AND oauth_user_id = $2 AND role = $3
     RETURNING *`,
    [oauthProvider, oauthUserId, OrganizationRole.PartnerEndUser],
  )
  return result.rows[0] ?? null
}

// A page of the organisation's end users, removed ones included, in the
// order they were first enrolled.
const getEndUsers = async (
  organizationId: string,
  limit: number,
  offset: number,
): Promise<{ endUsers: DBOrganizationMember[]; totalCount: number }> => {
  const db = await getDatabase()
  const [page, count] = await Promise.all([
    db.query<DBOrganizationMember>(
      `SELECT * FROM users.users_organizations
       WHERE organization_id = $1 AND role = $2
       ORDER BY created_at, oauth_user_id
       LIMIT $3 OFFSET $4`,
      [organizationId, OrganizationRole.PartnerEndUser, limit, offset],
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM users.users_organizations
       WHERE organization_id = $1 AND role = $2`,
      [organizationId, OrganizationRole.PartnerEndUser],
    ),
  ])
  return { endUsers: page.rows, totalCount: Number(count.rows[0].count) }
}

export const organizationMembersRepository = {
  getOrganizationMemberships,
  getOrganizationMembershipByUser,
  getOrganizationMembershipsByUsers,
  addMemberToOrganization,
  updateMemberRole,
  removeMemberFromOrganization,
  removeUserMemberships,
  getEndUsersByCustomerReferences,
  countActiveEndUsers,
  hasEndUsers,
  addEndUser,
  reenrollEndUser,
  getMembershipForUpdate,
  markEndUserRemoved,
  setEndUserQuota,
  closeEndUserMembership,
  getEndUsers,
}
