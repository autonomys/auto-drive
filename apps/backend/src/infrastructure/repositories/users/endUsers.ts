import { EndUser } from '@auto-drive/models'
import { getDatabase } from '../../drivers/pg.js'

type DBEndUser = {
  id: string
  organization_id: string
  public_id: string
  address: string
  customer_reference: string
  upload_quota_bytes: string | null
  created_at: Date
  removed_at: Date | null
}

const mapRow = (row: DBEndUser): EndUser => ({
  address: row.address,
  publicId: row.public_id,
  customerReference: row.customer_reference,
  uploadQuotaBytes:
    row.upload_quota_bytes === null ? null : Number(row.upload_quota_bytes),
  createdAt: row.created_at.toISOString(),
})

// The organisation's end users with any of these addresses or references.
const getActiveByAddressesOrReferences = async (
  organizationId: string,
  addresses: string[],
  customerReferences: string[],
): Promise<EndUser[]> => {
  const db = await getDatabase()
  const result = await db.query<DBEndUser>(
    `SELECT * FROM organization_end_users
     WHERE organization_id = $1 AND removed_at IS NULL
       AND (address = ANY($2::text[])
         OR customer_reference = ANY($3::text[]))`,
    [organizationId, addresses, customerReferences],
  )
  return result.rows.map(mapRow)
}

const countActive = async (organizationId: string): Promise<number> => {
  const db = await getDatabase()
  const result = await db.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM organization_end_users WHERE organization_id = $1 AND removed_at IS NULL',
    [organizationId],
  )
  return Number(result.rows[0].count)
}

const listActive = async (
  organizationId: string,
  limit: number,
  offset: number,
): Promise<EndUser[]> => {
  const db = await getDatabase()
  const result = await db.query<DBEndUser>(
    `SELECT * FROM organization_end_users
     WHERE organization_id = $1 AND removed_at IS NULL
     ORDER BY created_at, id
     LIMIT $2 OFFSET $3`,
    [organizationId, limit, offset],
  )
  return result.rows.map(mapRow)
}

// One statement, so either all of them are enrolled or none is.
const insertEndUsers = async (
  organizationId: string,
  endUsers: Omit<EndUser, 'createdAt'>[],
): Promise<EndUser[]> => {
  const db = await getDatabase()
  const result = await db.query<DBEndUser>(
    `INSERT INTO organization_end_users
       (organization_id, public_id, address, customer_reference,
        upload_quota_bytes)
     SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::bigint[])
     RETURNING *`,
    [
      organizationId,
      endUsers.map((e) => e.publicId),
      endUsers.map((e) => e.address),
      endUsers.map((e) => e.customerReference),
      endUsers.map((e) => e.uploadQuotaBytes),
    ],
  )
  return result.rows.map(mapRow)
}

const markRemoved = async (
  organizationId: string,
  address: string,
): Promise<void> => {
  const db = await getDatabase()
  await db.query(
    'UPDATE organization_end_users SET removed_at = now() WHERE organization_id = $1 AND address = $2 AND removed_at IS NULL',
    [organizationId, address],
  )
}

export const endUsersRepository = {
  getActiveByAddressesOrReferences,
  countActive,
  listActive,
  insertEndUsers,
  markRemoved,
}
