import { DeletionAuditEntry } from '@auto-drive/models'
import { getDatabase } from '../drivers/pg.js'

type DBAuditEntry = {
  id: string
  user_public_id: string
  action: string
  details: Record<string, unknown> | null
  performed_at: Date
}

const mapRow = (row: DBAuditEntry): DeletionAuditEntry => ({
  id: row.id,
  userPublicId: row.user_public_id,
  action: row.action,
  details: row.details,
  performedAt: row.performed_at,
})

const createEntry = async (
  userPublicId: string,
  action: string,
  details?: Record<string, unknown>,
): Promise<DeletionAuditEntry> => {
  const db = await getDatabase()
  const result = await db.query<DBAuditEntry>(
    `INSERT INTO public.deletion_audit_log (user_public_id, action, details)
    VALUES ($1, $2, $3)
    RETURNING *`,
    [userPublicId, action, details ? JSON.stringify(details) : null],
  )

  return mapRow(result.rows[0])
}

const getByUser = async (
  userPublicId: string,
): Promise<DeletionAuditEntry[]> => {
  const db = await getDatabase()
  const result = await db.query<DBAuditEntry>(
    `SELECT * FROM public.deletion_audit_log
    WHERE user_public_id = $1
    ORDER BY performed_at DESC`,
    [userPublicId],
  )

  return result.rows.map(mapRow)
}

const getStats = async (): Promise<{
  totalAnonymisations: number
  recentAnonymisations: number
}> => {
  const db = await getDatabase()
  const result = await db.query<{
    total: string
    recent: string
  }>(
    `SELECT
      COUNT(DISTINCT user_public_id) FILTER (WHERE action = 'anonymisation_completed') AS total,
      COUNT(DISTINCT user_public_id) FILTER (
        WHERE action = 'anonymisation_completed'
        AND performed_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
      ) AS recent
    FROM public.deletion_audit_log`,
  )

  return {
    totalAnonymisations: parseInt(result.rows[0].total),
    recentAnonymisations: parseInt(result.rows[0].recent),
  }
}

export const deletionAuditRepository = {
  createEntry,
  getByUser,
  getStats,
}
