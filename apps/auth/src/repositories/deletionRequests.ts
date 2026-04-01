import { getDatabase } from '../drivers/pg.js'
import { DeletionRequestStatus } from '@auto-drive/models'

export interface DeletionRequestRow {
  id: string
  user_public_id: string
  oauth_provider: string
  oauth_user_id: string
  status: DeletionRequestStatus
  requested_at: Date
  scheduled_anonymisation_at: Date
  completed_at: Date | null
  cancelled_at: Date | null
  reason: string | null
  admin_notes: string | null
  created_at: Date
  updated_at: Date
}

export interface DeletionRequestWithUserRow extends DeletionRequestRow {
  oauth_username: string | null
}

const createDeletionRequest = async (
  userPublicId: string,
  oauthProvider: string,
  oauthUserId: string,
  scheduledAnonymisationAt: Date,
  reason?: string,
): Promise<DeletionRequestRow> => {
  const db = await getDatabase()
  const result = await db.query<DeletionRequestRow>(
    `INSERT INTO users.deletion_requests
      (user_public_id, oauth_provider, oauth_user_id, scheduled_anonymisation_at, reason)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [userPublicId, oauthProvider, oauthUserId, scheduledAnonymisationAt, reason ?? null],
  )

  return result.rows[0]
}

const getPendingByUser = async (
  oauthProvider: string,
  oauthUserId: string,
): Promise<DeletionRequestRow | null> => {
  const db = await getDatabase()
  const result = await db.query<DeletionRequestRow>(
    `SELECT * FROM users.deletion_requests
    WHERE oauth_provider = $1 AND oauth_user_id = $2 AND status = $3
    ORDER BY requested_at DESC LIMIT 1`,
    [oauthProvider, oauthUserId, DeletionRequestStatus.Pending],
  )

  return result.rows.at(0) ?? null
}

const getPendingByPublicId = async (
  userPublicId: string,
): Promise<DeletionRequestRow | null> => {
  const db = await getDatabase()
  const result = await db.query<DeletionRequestRow>(
    `SELECT * FROM users.deletion_requests
    WHERE user_public_id = $1 AND status = $2
    ORDER BY requested_at DESC LIMIT 1`,
    [userPublicId, DeletionRequestStatus.Pending],
  )

  return result.rows.at(0) ?? null
}

const cancelRequest = async (id: string): Promise<DeletionRequestRow | null> => {
  const db = await getDatabase()
  const result = await db.query<DeletionRequestRow>(
    `UPDATE users.deletion_requests
    SET status = $1, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND status = $3
    RETURNING *`,
    [DeletionRequestStatus.Cancelled, id, DeletionRequestStatus.Pending],
  )

  return result.rows.at(0) ?? null
}

const getById = async (id: string): Promise<DeletionRequestRow | null> => {
  const db = await getDatabase()
  const result = await db.query<DeletionRequestRow>(
    'SELECT * FROM users.deletion_requests WHERE id = $1',
    [id],
  )

  return result.rows.at(0) ?? null
}

const getDueForAnonymisation = async (): Promise<DeletionRequestRow[]> => {
  const db = await getDatabase()
  const result = await db.query<DeletionRequestRow>(
    `SELECT * FROM users.deletion_requests
    WHERE status = $1 AND scheduled_anonymisation_at <= CURRENT_TIMESTAMP
    ORDER BY scheduled_anonymisation_at ASC`,
    [DeletionRequestStatus.Pending],
  )

  return result.rows
}

const updateStatus = async (
  id: string,
  status: DeletionRequestStatus,
  fromStatus?: DeletionRequestStatus,
): Promise<DeletionRequestRow | null> => {
  const db = await getDatabase()
  const completedAt =
    status === DeletionRequestStatus.Completed ? 'CURRENT_TIMESTAMP' : 'completed_at'

  const params: (string | DeletionRequestStatus)[] = [status, id]
  let whereClause = 'WHERE id = $2'

  if (fromStatus) {
    params.push(fromStatus)
    whereClause += ` AND status = $${params.length}`
  }

  const result = await db.query<DeletionRequestRow>(
    `UPDATE users.deletion_requests
    SET status = $1, completed_at = ${completedAt}, updated_at = CURRENT_TIMESTAMP
    ${whereClause}
    RETURNING *`,
    params,
  )

  return result.rows.at(0) ?? null
}

const updateAdminNotes = async (
  id: string,
  adminNotes: string,
): Promise<DeletionRequestRow | null> => {
  const db = await getDatabase()
  const result = await db.query<DeletionRequestRow>(
    `UPDATE users.deletion_requests
    SET admin_notes = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *`,
    [adminNotes, id],
  )

  return result.rows.at(0) ?? null
}

const getAllByStatus = async (
  status?: DeletionRequestStatus,
): Promise<DeletionRequestWithUserRow[]> => {
  const db = await getDatabase()

  if (status) {
    const result = await db.query<DeletionRequestWithUserRow>(
      `SELECT dr.*, u.oauth_username
      FROM users.deletion_requests dr
      JOIN users.users u ON dr.oauth_provider = u.oauth_provider AND dr.oauth_user_id = u.oauth_user_id
      WHERE dr.status = $1
      ORDER BY dr.requested_at DESC`,
      [status],
    )
    return result.rows
  }

  const result = await db.query<DeletionRequestWithUserRow>(
    `SELECT dr.*, u.oauth_username
    FROM users.deletion_requests dr
    JOIN users.users u ON dr.oauth_provider = u.oauth_provider AND dr.oauth_user_id = u.oauth_user_id
    ORDER BY dr.requested_at DESC`,
  )

  return result.rows
}

const getAll = async (): Promise<DeletionRequestWithUserRow[]> => {
  return getAllByStatus()
}

export const deletionRequestsRepository = {
  createDeletionRequest,
  getPendingByUser,
  getPendingByPublicId,
  cancelRequest,
  getById,
  getDueForAnonymisation,
  updateStatus,
  updateAdminNotes,
  getAllByStatus,
  getAll,
}
