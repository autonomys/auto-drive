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
  actor_api_key_id: string | null
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
    // The organisation API key that made the change, if one did.
    actorApiKeyId?: string | null
  },
  db: pg.Client,
): Promise<void> => {
  await db.query(
    `INSERT INTO users.organization_membership_changes
       (id, oauth_provider, oauth_user_id, from_organization_id,
        to_organization_id, role, actor, actor_api_key_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      v4(),
      change.oauthProvider,
      change.oauthUserId,
      change.fromOrganizationId,
      change.toOrganizationId,
      change.role,
      change.actor,
      change.actorApiKeyId ?? null,
    ],
  )
}

// The organisation's member changes, newest first. Partner end users'
// enrolments and removals stay in the table but are left out: the end user
// list shows them, and a partner's thousands would bury the rest.
const getChangesByOrganization = async (
  organizationId: string,
): Promise<DBOrganizationMembershipChange[]> => {
  const db = await getDatabase()
  const result = await db.query<DBOrganizationMembershipChange>(
    `SELECT * FROM users.organization_membership_changes
     WHERE (from_organization_id = $1 OR to_organization_id = $1)
       AND (role IS NULL OR role <> $2)
     ORDER BY created_at DESC, id`,
    [organizationId, OrganizationRole.PartnerEndUser],
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
