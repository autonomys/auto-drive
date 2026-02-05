import { getDatabase } from '../../drivers/pg.js'
import {
  AccountModel,
  Account,
  InteractionType,
  AccountWithTotalSize,
} from '@auto-drive/models'

type DBAccount = {
  id: string
  organization_id: string
  model: AccountModel
  upload_limit: number
  download_limit: number
}

type DBAccountWithTotalSize = DBAccount & {
  total_size: string | number
}

const mapRows = (rows: DBAccount[]): Account[] => {
  return rows.map((row) => ({
    id: row.id,
    uploadLimit: Number(row.upload_limit),
    downloadLimit: Number(row.download_limit),
    organizationId: row.organization_id,
    model: row.model as AccountModel,
  }))
}

const mapRowsWithSize = (
  rows: DBAccountWithTotalSize[],
): AccountWithTotalSize[] => {
  return rows.map((row) => ({
    id: row.id,
    uploadLimit: Number(row.upload_limit),
    downloadLimit: Number(row.download_limit),
    organizationId: row.organization_id,
    model: row.model as AccountModel,
    totalSize: Number(row.total_size),
  }))
}

const getByOrganizationId = async (
  organizationId: string,
): Promise<Account | null> => {
  const db = await getDatabase()
  const result = await db.query<DBAccount>(
    'SELECT * FROM accounts WHERE organization_id = $1',
    [organizationId],
  )
  return mapRows(result.rows)[0] || null
}

const getById = async (id: string): Promise<Account | null> => {
  const db = await getDatabase()
  const result = await db.query<DBAccount>(
    'SELECT * FROM accounts WHERE id = $1',
    [id],
  )
  return mapRows(result.rows)[0] || null
}

const createAccount = async (
  id: string,
  organizationId: string,
  model: string,
  uploadLimit: number,
  downloadLimit: number,
): Promise<Account> => {
  const db = await getDatabase()
  const result = await db.query<DBAccount>(
    'INSERT INTO accounts (id, organization_id, "model", "upload_limit", "download_limit") VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, organizationId, model, uploadLimit, downloadLimit],
  )
  return mapRows(result.rows)[0]
}

const updateAccount = async (
  id: string,
  model: string,
  uploadLimit: number,
  downloadLimit: number,
): Promise<Account> => {
  const db = await getDatabase()
  const result = await db.query<DBAccount>(
    'UPDATE accounts SET "model" = $1, "upload_limit" = $2, "download_limit" = $3 WHERE id = $4',
    [model, uploadLimit, downloadLimit, id],
  )
  return mapRows(result.rows)[0]
}

const getAll = async (): Promise<Account[]> => {
  const db = await getDatabase()

  const result = await db.query<DBAccount>('SELECT * FROM accounts')
  return mapRows(result.rows)
}

export const getTopAccountsWithinPeriod = async (
  type: InteractionType = InteractionType.Upload,
  fromDate: Date,
  toDate: Date,
  limit: number = 10,
): Promise<AccountWithTotalSize[]> => {
  const db = await getDatabase()

  // Move filter conditions to JOIN clause to preserve LEFT JOIN semantics
  // and only return accounts that have interactions in the period
  const result = await db.query<DBAccountWithTotalSize>(
    `SELECT a.*, COALESCE(SUM(i.size), 0)::bigint as total_size 
     FROM accounts a 
     INNER JOIN interactions i ON a.id = i.account_id 
       AND i.type = $1 
       AND i.created_at >= $2 
       AND i.created_at <= $3
     GROUP BY a.id 
     ORDER BY total_size DESC 
     LIMIT $4`,
    [type, fromDate, toDate, limit],
  )
  return mapRowsWithSize(result.rows)
}

export const accountsRepository = {
  getByOrganizationId,
  createAccount,
  updateAccount,
  getAll,
  getById,
  getTopAccountsWithinPeriod,
}
