import { getDatabase } from '../../drivers/pg.js'
import { AccountModel, Account } from '@auto-drive/models'

type DBSubscription = {
  id: string
  organization_id: string
  granularity: AccountModel
  upload_limit: number
  download_limit: number
}

const mapRows = (rows: DBSubscription[]): Account[] => {
  return rows.map((row) => ({
    id: row.id,
    uploadLimit: Number(row.upload_limit),
    downloadLimit: Number(row.download_limit),
    organizationId: row.organization_id,
    model: row.granularity as AccountModel,
  }))
}

const getByOrganizationId = async (
  organizationId: string,
): Promise<Account | null> => {
  const db = await getDatabase()
  const result = await db.query<DBSubscription>(
    'SELECT * FROM accounts WHERE organization_id = $1',
    [organizationId],
  )
  return mapRows(result.rows)[0] || null
}

const getById = async (id: string): Promise<Account | null> => {
  const db = await getDatabase()
  const result = await db.query<DBSubscription>(
    'SELECT * FROM accounts WHERE id = $1',
    [id],
  )
  return mapRows(result.rows)[0] || null
}

const createSubscription = async (
  id: string,
  organizationId: string,
  model: string,
  uploadLimit: number,
  downloadLimit: number,
): Promise<Account> => {
  const db = await getDatabase()
  const result = await db.query<DBSubscription>(
    'INSERT INTO accounts (id, organization_id, "model", "upload_limit", "download_limit") VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, organizationId, model, uploadLimit, downloadLimit],
  )
  return mapRows(result.rows)[0]
}

const updateSubscription = async (
  id: string,
  model: string,
  uploadLimit: number,
  downloadLimit: number,
): Promise<Account> => {
  const db = await getDatabase()
  const result = await db.query<DBSubscription>(
    'UPDATE accounts SET "model" = $1, "upload_limit" = $2, "download_limit" = $3 WHERE id = $4',
    [model, uploadLimit, downloadLimit, id],
  )
  return mapRows(result.rows)[0]
}

const getAll = async (): Promise<Account[]> => {
  const db = await getDatabase()

  const result = await db.query<DBSubscription>('SELECT * FROM accounts')
  return mapRows(result.rows)
}

export const accountsRepository = {
  getByOrganizationId,
  createSubscription,
  updateSubscription,
  getAll,
  getById,
}
