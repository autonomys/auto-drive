import pg from 'pg'
import { getDatabase } from '../../drivers/pg.js'
import {
  AccountModel,
  Account,
  InteractionType,
  AccountWithTotalSize,
  AccountTermsChange,
} from '@auto-drive/models'

type DBAccount = {
  id: string
  organization_id: string
  model: AccountModel
  upload_limit: number
  download_limit: number
  is_partner: boolean
  max_purchased_bytes: string | null
  credit_expiry_days: number | null
}

type DBAccountTermsChange = {
  id: string
  account_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  reason: string | null
  created_at: Date
}

// The terms an admin can set on an account. A null override means use the
// global default.
export type AccountTerms = {
  model: AccountModel
  uploadLimit: number
  downloadLimit: number
  maxPurchasedBytes: number | null
  creditExpiryDays: number | null
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
    isPartner: row.is_partner,
    maxPurchasedBytes:
      row.max_purchased_bytes === null ? null : Number(row.max_purchased_bytes),
    creditExpiryDays: row.credit_expiry_days,
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
    isPartner: row.is_partner,
    maxPurchasedBytes:
      row.max_purchased_bytes === null ? null : Number(row.max_purchased_bytes),
    creditExpiryDays: row.credit_expiry_days,
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

const insertTermsChange = (
  client: pg.PoolClient,
  accountId: string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  changedBy: string,
  reason?: string,
) =>
  client.query(
    'INSERT INTO account_terms_changes (account_id, field, old_value, new_value, changed_by, reason) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      accountId,
      field,
      oldValue === null ? null : String(oldValue),
      newValue === null ? null : String(newValue),
      changedBy,
      reason ?? null,
    ],
  )

// `partnerFlaggedBy` makes the account a partner account, flagged by that
// admin, which is recorded in the terms history.
const createAccount = async (
  id: string,
  organizationId: string,
  model: string,
  uploadLimit: number,
  downloadLimit: number,
  partnerFlaggedBy?: string,
): Promise<Account> => {
  const db = await getDatabase()
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    // An organisation has one account (accounts_organization_id_key). If a
    // concurrent request created it first, that one is returned.
    const result = await client.query<DBAccount>(
      'INSERT INTO accounts (id, organization_id, "model", "upload_limit", "download_limit", is_partner) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (organization_id) DO NOTHING RETURNING *',
      [
        id,
        organizationId,
        model,
        uploadLimit,
        downloadLimit,
        partnerFlaggedBy !== undefined,
      ],
    )
    if (result.rows.length > 0 && partnerFlaggedBy !== undefined) {
      await insertTermsChange(
        client,
        id,
        'is_partner',
        false,
        true,
        partnerFlaggedBy,
      )
    }
    await client.query('COMMIT')

    const [created] = mapRows(result.rows)
    if (created) return created
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  const existing = await getByOrganizationId(organizationId)
  if (!existing) {
    throw new Error(`Account for organization ${organizationId} not found`)
  }
  return existing
}

// Writes the terms and one history row per field that actually changed, in one
// transaction. The row is locked so the history is diffed against what was
// really replaced.
const updateAccount = async (
  id: string,
  terms: AccountTerms,
  changedBy: string,
  reason?: string,
): Promise<Account> => {
  const db = await getDatabase()
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const before = (
      await client.query<DBAccount>(
        'SELECT * FROM accounts WHERE id = $1 FOR UPDATE',
        [id],
      )
    ).rows[0]
    if (!before) throw new Error(`Account ${id} not found`)

    const after = (
      await client.query<DBAccount>(
        'UPDATE accounts SET "model" = $1, "upload_limit" = $2, "download_limit" = $3, max_purchased_bytes = $4, credit_expiry_days = $5 WHERE id = $6 RETURNING *',
        [
          terms.model,
          terms.uploadLimit,
          terms.downloadLimit,
          terms.maxPurchasedBytes,
          terms.creditExpiryDays,
          id,
        ],
      )
    ).rows[0]

    for (const field of [
      'max_purchased_bytes',
      'credit_expiry_days',
      'upload_limit',
      'download_limit',
      'model',
    ] as const) {
      if (String(before[field]) !== String(after[field])) {
        await insertTermsChange(
          client,
          id,
          field,
          before[field],
          after[field],
          changedBy,
          reason,
        )
      }
    }

    await client.query('COMMIT')
    return mapRows([after])[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const getTermsChanges = async (
  accountId: string,
): Promise<AccountTermsChange[]> => {
  const db = await getDatabase()
  const result = await db.query<DBAccountTermsChange>(
    'SELECT * FROM account_terms_changes WHERE account_id = $1 ORDER BY created_at DESC, id DESC',
    [accountId],
  )
  return result.rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
    changedBy: row.changed_by,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  }))
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

const getPartnerAccounts = async (): Promise<Account[]> => {
  const db = await getDatabase()
  const result = await db.query<DBAccount>(
    'SELECT * FROM accounts WHERE is_partner ORDER BY created_at, id',
  )
  return mapRows(result.rows)
}

export const accountsRepository = {
  getPartnerAccounts,
  getTermsChanges,
  getByOrganizationId,
  createAccount,
  updateAccount,
  getAll,
  getById,
  getTopAccountsWithinPeriod,
}
