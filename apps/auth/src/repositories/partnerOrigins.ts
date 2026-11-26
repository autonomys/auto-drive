import pg from 'pg'
import { getDatabase } from '../drivers/pg.js'

export type DBPartnerOrigin = {
  origin: string
  organization_id: string
  created_by: string
  created_at: Date
}

// The partner organisation an origin belongs to, or null if it is not a
// partner origin.
const getOrganizationIdByOrigin = async (
  origin: string,
): Promise<string | null> => {
  const db = await getDatabase()
  const result = await db.query<Pick<DBPartnerOrigin, 'organization_id'>>(
    'SELECT organization_id FROM users.partner_origins WHERE origin = $1',
    [origin],
  )
  return result.rows[0]?.organization_id ?? null
}

const getOriginsByOrganization = async (
  organizationId: string,
): Promise<DBPartnerOrigin[]> => {
  const db = await getDatabase()
  const result = await db.query<DBPartnerOrigin>(
    `SELECT * FROM users.partner_origins
     WHERE organization_id = $1
     ORDER BY created_at, origin`,
    [organizationId],
  )
  return result.rows
}

const getOriginForUpdate = async (
  origin: string,
  db: pg.Client,
): Promise<DBPartnerOrigin | null> => {
  const result = await db.query<DBPartnerOrigin>(
    'SELECT * FROM users.partner_origins WHERE origin = $1 FOR UPDATE',
    [origin],
  )
  return result.rows[0] ?? null
}

const addOrigin = async (
  origin: { origin: string; organizationId: string; createdBy: string },
  db: pg.Client,
): Promise<DBPartnerOrigin> => {
  const result = await db.query<DBPartnerOrigin>(
    `INSERT INTO users.partner_origins (origin, organization_id, created_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [origin.origin, origin.organizationId, origin.createdBy],
  )
  return result.rows[0]
}

const removeOrigin = async (origin: string, db: pg.Client): Promise<void> => {
  await db.query('DELETE FROM users.partner_origins WHERE origin = $1', [
    origin,
  ])
}

export const partnerOriginsRepository = {
  getOrganizationIdByOrigin,
  getOriginsByOrganization,
  getOriginForUpdate,
  addOrigin,
  removeOrigin,
}
