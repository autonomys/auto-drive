import {
  PurchasedCredit,
  PurchasedCreditSummary,
} from '@auto-drive/models'
import { getDatabase } from '../../drivers/pg.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('repositories:purchasedCredits')

// ---------------------------------------------------------------------------
// Internal DB row type
// ---------------------------------------------------------------------------

type DBPurchasedCredit = {
  id: string
  account_id: string
  intent_id: string
  upload_bytes_original: string
  upload_bytes_remaining: string
  download_bytes_original: string
  download_bytes_remaining: string
  purchased_at: Date
  expires_at: Date
  expired: boolean
  created_at: Date
  updated_at: Date
}

const mapRow = (row: DBPurchasedCredit): PurchasedCredit => ({
  id: row.id,
  accountId: row.account_id,
  intentId: row.intent_id,
  uploadBytesOriginal: BigInt(row.upload_bytes_original),
  uploadBytesRemaining: BigInt(row.upload_bytes_remaining),
  downloadBytesOriginal: BigInt(row.download_bytes_original),
  downloadBytesRemaining: BigInt(row.download_bytes_remaining),
  purchasedAt: row.purchased_at,
  expiresAt: row.expires_at,
  expired: row.expired,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

// ---------------------------------------------------------------------------
// createPurchasedCredit
// Called by onConfirmedIntent() once a payment is confirmed on-chain.
// ---------------------------------------------------------------------------

type CreatePurchasedCreditParams = {
  accountId: string
  intentId: string
  uploadBytesOriginal: bigint
  downloadBytesOriginal: bigint
  expiresAt: Date
}

const createPurchasedCredit = async (
  params: CreatePurchasedCreditParams,
): Promise<PurchasedCredit> => {
  const db = await getDatabase()
  const result = await db.query<DBPurchasedCredit>(
    `INSERT INTO purchased_credits (
       account_id,
       intent_id,
       upload_bytes_original,
       upload_bytes_remaining,
       download_bytes_original,
       download_bytes_remaining,
       expires_at
     ) VALUES ($1, $2, $3, $3, $4, $4, $5)
     RETURNING *`,
    [
      params.accountId,
      params.intentId,
      params.uploadBytesOriginal.toString(),
      params.downloadBytesOriginal.toString(),
      params.expiresAt,
    ],
  )
  return mapRow(result.rows[0])
}

// ---------------------------------------------------------------------------
// getActiveByAccountId
// Returns non-expired rows with remaining bytes, ordered FIFO:
// soonest-expiry first, then oldest purchase within the same expiry window.
// ---------------------------------------------------------------------------

const getActiveByAccountId = async (
  accountId: string,
): Promise<PurchasedCredit[]> => {
  const db = await getDatabase()
  const result = await db.query<DBPurchasedCredit>(
    `SELECT *
     FROM purchased_credits
     WHERE account_id = $1
       AND expired = FALSE
       AND expires_at > NOW()
       AND (upload_bytes_remaining > 0 OR download_bytes_remaining > 0)
     ORDER BY expires_at ASC, purchased_at ASC`,
    [accountId],
  )
  return result.rows.map(mapRow)
}

// ---------------------------------------------------------------------------
// consumeUpTo
// Atomically consumes up to `bytes` from purchased credit rows in FIFO order
// (soonest-expiry first). Returns the number of bytes actually consumed.
// Never fails — if fewer than `bytes` are available it simply drains whatever
// exists and returns that amount. This is the sole consumption path; it
// replaced an earlier two-phase approach that had a TOCTOU race between
// transactions.
// ---------------------------------------------------------------------------

const consumeUpTo = async (
  accountId: string,
  creditType: 'upload' | 'download',
  bytes: bigint,
): Promise<bigint> => {
  if (bytes <= BigInt(0)) return BigInt(0)

  const db = await getDatabase()
  const client = await db.connect()

  try {
    await client.query('BEGIN')

    const remainingCol =
      creditType === 'upload'
        ? 'upload_bytes_remaining'
        : 'download_bytes_remaining'

    const rowsResult = await client.query<DBPurchasedCredit>(
      `SELECT *
       FROM purchased_credits
       WHERE account_id = $1
         AND expired = FALSE
         AND expires_at > NOW()
         AND ${remainingCol} > 0
       ORDER BY expires_at ASC, purchased_at ASC
       FOR UPDATE`,
      [accountId],
    )

    const rows = rowsResult.rows
    let toConsume = bytes
    let totalConsumed = BigInt(0)

    for (const row of rows) {
      if (toConsume <= BigInt(0)) break

      const rowRemaining = BigInt(
        creditType === 'upload'
          ? row.upload_bytes_remaining
          : row.download_bytes_remaining,
      )

      const deduction = toConsume < rowRemaining ? toConsume : rowRemaining
      const newRemaining = rowRemaining - deduction

      await client.query(
        `UPDATE purchased_credits
         SET ${remainingCol} = $1, updated_at = NOW()
         WHERE id = $2`,
        [newRemaining.toString(), row.id],
      )

      toConsume -= deduction
      totalConsumed += deduction
    }

    await client.query('COMMIT')
    return totalConsumed
  } catch (error) {
    await client.query('ROLLBACK')
    logger.error(error, 'consumeUpTo: transaction failed, rolled back')
    throw error
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// getRemainingCredits
// Single-query aggregate: total remaining purchased bytes + nearest expiry.
// Used by cap enforcement and the credits summary API endpoint.
// ---------------------------------------------------------------------------

const getRemainingCredits = async (
  accountId: string,
): Promise<PurchasedCreditSummary> => {
  const db = await getDatabase()
  const result = await db.query<{
    upload_bytes_remaining: string
    download_bytes_remaining: string
    next_expiry: Date | null
    active_row_count: string
  }>(
    `SELECT
       COALESCE(SUM(upload_bytes_remaining),   0) AS upload_bytes_remaining,
       COALESCE(SUM(download_bytes_remaining), 0) AS download_bytes_remaining,
       MIN(expires_at)                            AS next_expiry,
       COUNT(*)                                   AS active_row_count
     FROM purchased_credits
     WHERE account_id = $1
       AND expired = FALSE
       AND expires_at > NOW()
       AND (upload_bytes_remaining > 0 OR download_bytes_remaining > 0)`,
    [accountId],
  )

  const row = result.rows[0]
  return {
    uploadBytesRemaining: BigInt(row.upload_bytes_remaining),
    downloadBytesRemaining: BigInt(row.download_bytes_remaining),
    nextExpiryDate: row.next_expiry ?? null,
    activeRowCount: Number(row.active_row_count),
  }
}

// ---------------------------------------------------------------------------
// getExpiringCredits
// Returns active rows expiring within N days. Used by expiry warning banners.
// ---------------------------------------------------------------------------

const getExpiringCredits = async (
  withinDays: number,
): Promise<PurchasedCredit[]> => {
  const db = await getDatabase()
  const result = await db.query<DBPurchasedCredit>(
    `SELECT *
     FROM purchased_credits
     WHERE expired = FALSE
       AND expires_at > NOW()
       AND expires_at <= NOW() + ($1 * INTERVAL '1 day')
       AND (upload_bytes_remaining > 0 OR download_bytes_remaining > 0)
     ORDER BY expires_at ASC`,
    [withinDays],
  )
  return result.rows.map(mapRow)
}

// ---------------------------------------------------------------------------
// markExpiredCredits
// Called by the credit expiry background job (to be added in a later PR).
// Atomically marks all rows whose expires_at has passed and returns a summary
// of bytes forfeited for logging and metrics.
// ---------------------------------------------------------------------------

export type ExpiredCreditsSummary = {
  expiredCount: number
  totalUploadBytesForfeited: bigint
  totalDownloadBytesForfeited: bigint
}

const markExpiredCredits = async (): Promise<ExpiredCreditsSummary> => {
  const db = await getDatabase()
  const result = await db.query<{
    count: string
    upload_forfeited: string
    download_forfeited: string
  }>(
    `WITH expired AS (
       UPDATE purchased_credits
       SET expired = TRUE, updated_at = NOW()
       WHERE expired = FALSE
         AND expires_at <= NOW()
       RETURNING upload_bytes_remaining, download_bytes_remaining
     )
     SELECT
       COUNT(*)                                     AS count,
       COALESCE(SUM(upload_bytes_remaining),   0)  AS upload_forfeited,
       COALESCE(SUM(download_bytes_remaining), 0)  AS download_forfeited
     FROM expired`,
  )

  const row = result.rows[0]
  return {
    expiredCount: Number(row.count),
    totalUploadBytesForfeited: BigInt(row.upload_forfeited),
    totalDownloadBytesForfeited: BigInt(row.download_forfeited),
  }
}

// ---------------------------------------------------------------------------
// getByAccountId
// Full history including expired rows. Used by the credit history table.
// ---------------------------------------------------------------------------

const getByAccountId = async (
  accountId: string,
): Promise<PurchasedCredit[]> => {
  const db = await getDatabase()
  const result = await db.query<DBPurchasedCredit>(
    `SELECT *
     FROM purchased_credits
     WHERE account_id = $1
     ORDER BY purchased_at DESC`,
    [accountId],
  )
  return result.rows.map(mapRow)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const purchasedCreditsRepository = {
  createPurchasedCredit,
  getActiveByAccountId,
  consumeUpTo,
  getRemainingCredits,
  getExpiringCredits,
  markExpiredCredits,
  getByAccountId,
}
