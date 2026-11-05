import pg from 'pg'
import { v4 } from 'uuid'
import { OrganizationRole } from '@auto-drive/models'
import { getDatabase } from '../drivers/pg.js'

type DBOrganizationMembershipChange = {
  id: string
  oauth_provider: string
  oauth_user_id: string
  from_organization_id: string | null
  to_organization_id: string | null
  role: OrganizationRole | null
  actor: string
  created_at: Date
}

const recordChange = async (
  change: {
    oauthProvider: string
    oauthUserId: string
    fromOrganizationId: string | null
    toOrganizationId: string | null
    role: OrganizationRole | null
    actor: string
  },
  db: pg.Client,
): Promise<void> => {
  await db.query(
    `INSERT INTO users.organization_membership_changes
       (id, oauth_provider, oauth_user_id, from_organization_id,
        to_organization_id, role, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      v4(),
      change.oauthProvider,
      change.oauthUserId,
      change.fromOrganizationId,
      change.toOrganizationId,
      change.role,
      change.actor,
    ],
  )
}

const getChangesByOrganization = async (
  organizationId: string,
): Promise<DBOrganizationMembershipChange[]> => {
  const db = await getDatabase()
  const result = await db.query<DBOrganizationMembershipChange>(
    `SELECT * FROM users.organization_membership_changes
     WHERE from_organization_id = $1 OR to_organization_id = $1
     ORDER BY created_at DESC, id`,
    [organizationId],
  )
  return result.rows
}

// The user's latest move into the organisation from another one.
const getLatestMoveInto = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string,
  db: pg.Client,
): Promise<DBOrganizationMembershipChange | null> => {
  const result = await db.query<DBOrganizationMembershipChange>(
    `SELECT * FROM users.organization_membership_changes
     WHERE to_organization_id = $1
       AND oauth_provider = $2 AND oauth_user_id = $3
       AND from_organization_id IS NOT NULL
       AND from_organization_id <> $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, oauthProvider, oauthUserId],
  )
  return result.rows[0] ?? null
}

export const organizationMembershipChangesRepository = {
  recordChange,
  getChangesByOrganization,
  getLatestMoveInto,
}
