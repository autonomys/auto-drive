import {
  TouVersion,
  TouAcceptance,
  TouChangeType,
  TouVersionStatus,
} from '@auto-drive/models'
import { getDatabase } from '../drivers/pg.js'

// ---------------------------------------------------------------------------
// Internal DB row types
// ---------------------------------------------------------------------------

type DBTouVersion = {
  id: string
  version_label: string
  effective_date: Date
  content_url: string
  change_type: string
  status: string
  admin_notes: string | null
  created_by: string
  created_at: Date
  updated_at: Date
}

type DBTouAcceptance = {
  id: string
  user_id: string
  version_id: string
  ip_address: string | null
  accepted_at: Date
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const mapVersionRow = (row: DBTouVersion): TouVersion => ({
  id: row.id,
  versionLabel: row.version_label,
  effectiveDate: row.effective_date,
  contentUrl: row.content_url,
  changeType: row.change_type as TouChangeType,
  status: row.status as TouVersionStatus,
  adminNotes: row.admin_notes,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapAcceptanceRow = (row: DBTouAcceptance): TouAcceptance => ({
  id: row.id,
  userId: row.user_id,
  versionId: row.version_id,
  ipAddress: row.ip_address,
  acceptedAt: row.accepted_at,
})

// ---------------------------------------------------------------------------
// ensureActiveVersion — lazy activation
// If a pending version has reached its effective date, atomically promote it
// to active and archive the previous active version.
// ---------------------------------------------------------------------------

const ensureActiveVersion = async (): Promise<TouVersion | null> => {
  const pool = await getDatabase()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const pendingResult = await client.query<DBTouVersion>(
      `SELECT * FROM tou_versions
       WHERE status = 'pending' AND effective_date <= NOW()
       ORDER BY effective_date ASC
       LIMIT 1`,
    )

    if (pendingResult.rows[0]) {
      await client.query(
        `UPDATE tou_versions SET status = 'archived', updated_at = NOW()
         WHERE status = 'active'`,
      )

      const promoted = await client.query<DBTouVersion>(
        `UPDATE tou_versions SET status = 'active', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [pendingResult.rows[0].id],
      )

      await client.query('COMMIT')
      return mapVersionRow(promoted.rows[0])
    }

    await client.query('COMMIT')

    const activeResult = await client.query<DBTouVersion>(
      'SELECT * FROM tou_versions WHERE status = \'active\' LIMIT 1',
    )
    return activeResult.rows[0] ? mapVersionRow(activeResult.rows[0]) : null
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// getActiveVersion
// ---------------------------------------------------------------------------

const getActiveVersion = async (): Promise<TouVersion | null> => {
  const db = await getDatabase()
  const result = await db.query<DBTouVersion>(
    'SELECT * FROM tou_versions WHERE status = \'active\' LIMIT 1',
  )
  return result.rows[0] ? mapVersionRow(result.rows[0]) : null
}

// ---------------------------------------------------------------------------
// getPendingVersion
// ---------------------------------------------------------------------------

const getPendingVersion = async (): Promise<TouVersion | null> => {
  const db = await getDatabase()
  const result = await db.query<DBTouVersion>(
    'SELECT * FROM tou_versions WHERE status = \'pending\' LIMIT 1',
  )
  return result.rows[0] ? mapVersionRow(result.rows[0]) : null
}

// ---------------------------------------------------------------------------
// getVersionById
// ---------------------------------------------------------------------------

const getVersionById = async (id: string): Promise<TouVersion | null> => {
  const db = await getDatabase()
  const result = await db.query<DBTouVersion>(
    'SELECT * FROM tou_versions WHERE id = $1',
    [id],
  )
  return result.rows[0] ? mapVersionRow(result.rows[0]) : null
}

// ---------------------------------------------------------------------------
// getAllVersions — admin listing
// ---------------------------------------------------------------------------

const getAllVersions = async (): Promise<TouVersion[]> => {
  const db = await getDatabase()
  const result = await db.query<DBTouVersion>(
    'SELECT * FROM tou_versions ORDER BY created_at DESC',
  )
  return result.rows.map(mapVersionRow)
}

// ---------------------------------------------------------------------------
// createVersion
// ---------------------------------------------------------------------------

type CreateVersionParams = {
  versionLabel: string
  effectiveDate: Date
  contentUrl: string
  changeType: TouChangeType
  adminNotes: string | null
  createdBy: string
}

const createVersion = async (
  params: CreateVersionParams,
): Promise<TouVersion> => {
  const db = await getDatabase()
  const result = await db.query<DBTouVersion>(
    `INSERT INTO tou_versions (
       version_label, effective_date, content_url, change_type, admin_notes, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.versionLabel,
      params.effectiveDate,
      params.contentUrl,
      params.changeType,
      params.adminNotes,
      params.createdBy,
    ],
  )
  return mapVersionRow(result.rows[0])
}

// ---------------------------------------------------------------------------
// updateVersion — partial update for draft versions
// ---------------------------------------------------------------------------

type UpdateVersionParams = {
  versionLabel?: string
  effectiveDate?: Date
  contentUrl?: string
  changeType?: TouChangeType
  adminNotes?: string | null
}

const updateVersion = async (
  id: string,
  params: UpdateVersionParams,
): Promise<TouVersion | null> => {
  const fields: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (params.versionLabel !== undefined) {
    fields.push(`version_label = $${idx++}`)
    values.push(params.versionLabel)
  }
  if (params.effectiveDate !== undefined) {
    fields.push(`effective_date = $${idx++}`)
    values.push(params.effectiveDate)
  }
  if (params.contentUrl !== undefined) {
    fields.push(`content_url = $${idx++}`)
    values.push(params.contentUrl)
  }
  if (params.changeType !== undefined) {
    fields.push(`change_type = $${idx++}`)
    values.push(params.changeType)
  }
  if (params.adminNotes !== undefined) {
    fields.push(`admin_notes = $${idx++}`)
    values.push(params.adminNotes)
  }

  if (fields.length === 0) return null

  fields.push('updated_at = NOW()')
  values.push(id)

  const db = await getDatabase()
  const result = await db.query<DBTouVersion>(
    `UPDATE tou_versions SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  )

  return result.rows[0] ? mapVersionRow(result.rows[0]) : null
}

// ---------------------------------------------------------------------------
// updateVersionStatus
// ---------------------------------------------------------------------------

const updateVersionStatus = async (
  id: string,
  status: TouVersionStatus,
): Promise<TouVersion | null> => {
  const db = await getDatabase()
  const result = await db.query<DBTouVersion>(
    `UPDATE tou_versions SET status = $1, updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [status, id],
  )
  return result.rows[0] ? mapVersionRow(result.rows[0]) : null
}

// ---------------------------------------------------------------------------
// activateVersionTransactional — atomically archive current active + activate
// ---------------------------------------------------------------------------

const activateVersionTransactional = async (
  id: string,
): Promise<TouVersion | null> => {
  const pool = await getDatabase()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE tou_versions SET status = 'archived', updated_at = NOW()
       WHERE status = 'active'`,
    )

    const result = await client.query<DBTouVersion>(
      `UPDATE tou_versions SET status = 'active', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id],
    )

    await client.query('COMMIT')
    return result.rows[0] ? mapVersionRow(result.rows[0]) : null
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// hasUserAcceptedVersion
// ---------------------------------------------------------------------------

const hasUserAcceptedVersion = async (
  userId: string,
  versionId: string,
): Promise<boolean> => {
  const db = await getDatabase()
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM user_tou_acceptance
       WHERE user_id = $1 AND version_id = $2
     ) AS exists`,
    [userId, versionId],
  )
  return result.rows[0].exists
}

// ---------------------------------------------------------------------------
// createAcceptance — idempotent via ON CONFLICT DO NOTHING
// ---------------------------------------------------------------------------

const createAcceptance = async (
  userId: string,
  versionId: string,
  ipAddress: string | null,
): Promise<TouAcceptance | null> => {
  const db = await getDatabase()
  const result = await db.query<DBTouAcceptance>(
    `INSERT INTO user_tou_acceptance (user_id, version_id, ip_address)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, version_id) DO NOTHING
     RETURNING *`,
    [userId, versionId, ipAddress],
  )
  return result.rows[0] ? mapAcceptanceRow(result.rows[0]) : null
}

// ---------------------------------------------------------------------------
// getVersionWithStats — version + acceptance count
// Note: totalActiveUsers is provided by the core layer via the auth service,
// since the backend DB does not have a users table.
// ---------------------------------------------------------------------------

const getVersionWithStats = async (
  id: string,
): Promise<(TouVersion & { acceptanceCount: number }) | null> => {
  const db = await getDatabase()

  const versionResult = await db.query<DBTouVersion>(
    'SELECT * FROM tou_versions WHERE id = $1',
    [id],
  )
  if (!versionResult.rows[0]) return null

  const acceptanceResult = await db.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM user_tou_acceptance WHERE version_id = $1',
    [id],
  )

  return {
    ...mapVersionRow(versionResult.rows[0]),
    acceptanceCount: Number(acceptanceResult.rows[0].count),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const touRepository = {
  ensureActiveVersion,
  getActiveVersion,
  getPendingVersion,
  getVersionById,
  getAllVersions,
  createVersion,
  updateVersion,
  updateVersionStatus,
  activateVersionTransactional,
  hasUserAcceptedVersion,
  createAcceptance,
  getVersionWithStats,
}
