import { getDatabase } from '../../drivers/pg.js'
import { OrganizationInvitation, OrganizationRole } from '@auto-drive/models'

type DBOrganizationInvitation = {
  id: string
  organization_id: string
  public_id: string
  role: OrganizationRole
  invited_by: string
  created_at: Date
  expires_at: Date
}

const mapRow = (row: DBOrganizationInvitation): OrganizationInvitation => ({
  id: row.id,
  organizationId: row.organization_id,
  publicId: row.public_id,
  role: row.role,
  invitedBy: row.invited_by,
  createdAt: row.created_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
})

// Open: neither accepted, declined nor revoked. An open invitation past its
// expiry can't be accepted, and inviting the user again renews it.
const OPEN =
  'accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL'
const PENDING = `${OPEN} AND expires_at > NOW()`

/**
 * Invites a user, or renews their open invitation with the new role, inviter
 * and expiry, keeping its ID.
 */
const upsertOpen = async (invitation: {
  id: string
  organizationId: string
  publicId: string
  role: OrganizationRole
  invitedBy: string
  expiresAt: Date
}): Promise<OrganizationInvitation> => {
  const db = await getDatabase()
  const result = await db.query<DBOrganizationInvitation>(
    `INSERT INTO organization_invitations
       (id, organization_id, public_id, role, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (organization_id, public_id) WHERE ${OPEN}
     DO UPDATE SET role = EXCLUDED.role,
                   invited_by = EXCLUDED.invited_by,
                   created_at = NOW(),
                   expires_at = EXCLUDED.expires_at
     RETURNING *`,
    [
      invitation.id,
      invitation.organizationId,
      invitation.publicId,
      invitation.role,
      invitation.invitedBy,
      invitation.expiresAt,
    ],
  )
  return mapRow(result.rows[0])
}

/** Invitations that can still be accepted, newest first. */
const getPendingByOrganization = async (
  organizationId: string,
): Promise<OrganizationInvitation[]> => {
  const db = await getDatabase()
  const result = await db.query<DBOrganizationInvitation>(
    `SELECT * FROM organization_invitations
     WHERE organization_id = $1 AND ${PENDING}
     ORDER BY created_at DESC`,
    [organizationId],
  )
  return result.rows.map(mapRow)
}

/** A user's invitations that can still be accepted, newest first. */
const getPendingByPublicId = async (
  publicId: string,
): Promise<OrganizationInvitation[]> => {
  const db = await getDatabase()
  const result = await db.query<DBOrganizationInvitation>(
    `SELECT * FROM organization_invitations
     WHERE public_id = $1 AND ${PENDING}
     ORDER BY created_at DESC`,
    [publicId],
  )
  return result.rows.map(mapRow)
}

const getPendingById = async (
  id: string,
): Promise<OrganizationInvitation | null> => {
  const db = await getDatabase()
  const result = await db.query<DBOrganizationInvitation>(
    `SELECT * FROM organization_invitations WHERE id = $1 AND ${PENDING}`,
    [id],
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

// Leaves out `exceptPublicId`'s invitation, which inviting them again renews
// rather than adds to.
const countPendingByOrganization = async (
  organizationId: string,
  exceptPublicId: string,
): Promise<number> => {
  const db = await getDatabase()
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM organization_invitations
     WHERE organization_id = $1 AND public_id <> $2 AND ${PENDING}`,
    [organizationId, exceptPublicId],
  )
  return Number(result.rows[0].count)
}

// Each outcome applies only to an open invitation, so it is recorded once.
// Returns whether it applied.
const close = async (
  id: string,
  outcome: 'accepted_at' | 'declined_at' | 'revoked_at',
  revokedBy: string | null = null,
): Promise<boolean> => {
  const db = await getDatabase()
  const result = await db.query(
    `UPDATE organization_invitations
     SET ${outcome} = NOW(), revoked_by = $2
     WHERE id = $1 AND ${OPEN}`,
    [id, revokedBy],
  )
  return (result.rowCount ?? 0) > 0
}

const markAccepted = (id: string) => close(id, 'accepted_at')
const markDeclined = (id: string) => close(id, 'declined_at')
// `by` is null when it lapsed because its sender lost the right to send it.
const revoke = (id: string, by: string | null) => close(id, 'revoked_at', by)

export const organizationInvitationsRepository = {
  upsertOpen,
  getPendingByOrganization,
  getPendingByPublicId,
  getPendingById,
  countPendingByOrganization,
  markAccepted,
  markDeclined,
  revoke,
}
