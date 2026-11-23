import {
  AdminFreeCredit,
  IntentStatus,
  PaymentMethod,
  PurchasedCredit,
  PurchasedCreditSummary,
} from '@auto-drive/models'
import pg from 'pg'
import { getDatabase } from '../../drivers/pg.js'
import { err, ok, Result } from 'neverthrow'
import { createLogger } from '../../drivers/logger.js'
import { intentsRepository } from './intents.js'

const logger = createLogger('repositories:purchasedCredits')

// ---------------------------------------------------------------------------
// Internal DB row type
// ---------------------------------------------------------------------------

type DBPurchasedCredit = {
  id: string
  account_id: string
  // Null for free credits, which have granted_by or grant_period instead.
  intent_id: string | null
  granted_by: string | null
  grant_reason: string | null
  grant_period: Date | null
  superseded_at: Date | null
  upload_bytes_original: string
  upload_bytes_remaining: string
  download_bytes_original: string
  download_bytes_remaining: string
  purchased_at: Date
  expires_at: Date
  expired: boolean
  refunded_at: Date | null
  refund_tx_hash: string | null
  refunded_upload_bytes: string | null
  created_at: Date
  updated_at: Date
}

// pg reads a date column as local midnight; this is that day at UTC midnight.
const utcDay = (date: Date) =>
  new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))

const mapRow = (row: DBPurchasedCredit): PurchasedCredit => ({
  id: row.id,
  accountId: row.account_id,
  intentId: row.intent_id,
  kind: row.intent_id
    ? 'purchase'
    : row.grant_period
      ? 'free_monthly'
      : 'free_one_time',
  grantPeriod: row.grant_period && utcDay(row.grant_period),
  supersededAt: row.superseded_at,
  uploadBytesOriginal: BigInt(row.upload_bytes_original),
  uploadBytesRemaining: BigInt(row.upload_bytes_remaining),
  downloadBytesOriginal: BigInt(row.download_bytes_original),
  downloadBytesRemaining: BigInt(row.download_bytes_remaining),
  purchasedAt: row.purchased_at,
  expiresAt: row.expires_at,
  expired: row.expired,
  refundedAt: row.refunded_at,
  refundTxHash: row.refund_tx_hash,
  refundedUploadBytes:
    row.refunded_upload_bytes === null
      ? null
      : BigInt(row.refunded_upload_bytes),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapFreeCredit = (row: DBPurchasedCredit): AdminFreeCredit => ({
  ...mapRow(row),
  grantedBy: row.granted_by,
  grantReason: row.grant_reason,
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
// Returns non-expired rows with remaining bytes in consumption order (see
// consumeUpTo).
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
     ORDER BY (intent_id IS NOT NULL), expires_at ASC, purchased_at ASC`,
    [accountId],
  )
  return result.rows.map(mapRow)
}

// ---------------------------------------------------------------------------
// consumeUpTo
// Consumes up to `bytes` from credit rows and returns what it took from each
// row. Free credits go first, so a partner never pays for bytes while it holds
// free ones; within free and within purchased rows, soonest expiry first, then
// oldest. Never fails — if fewer than `bytes` are available it drains whatever
// exists.
//
// Runs on the caller's client, inside the caller's transaction: the rows stay
// locked FOR UPDATE until the caller commits, and the caller writes the
// interaction and its per-batch consumption rows before committing, so the
// ledger can never disagree with the balances. Rolling back undoes everything.
//
// A replaced monthly batch is skipped by superseded_at: NOW() is when the
// caller's transaction began, which can be before the batch was ended.
// ---------------------------------------------------------------------------

export type BatchConsumption = {
  purchasedCreditId: string
  bytes: bigint
  /** The batch is free credits (no intent), not a purchase. */
  free: boolean
}

const consumeUpTo = async (
  client: pg.PoolClient,
  accountId: string,
  creditType: 'upload' | 'download',
  bytes: bigint,
): Promise<BatchConsumption[]> => {
  if (bytes <= BigInt(0)) return []

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
       AND superseded_at IS NULL
       AND ${remainingCol} > 0
     ORDER BY (intent_id IS NOT NULL), expires_at ASC, purchased_at ASC
     FOR UPDATE`,
    [accountId],
  )

  const consumed: BatchConsumption[] = []
  let toConsume = bytes

  for (const row of rowsResult.rows) {
    if (toConsume <= BigInt(0)) break

    const rowRemaining = BigInt(
      creditType === 'upload'
        ? row.upload_bytes_remaining
        : row.download_bytes_remaining,
    )

    const deduction = toConsume < rowRemaining ? toConsume : rowRemaining

    await client.query(
      `UPDATE purchased_credits
       SET ${remainingCol} = $1, updated_at = NOW()
       WHERE id = $2`,
      [(rowRemaining - deduction).toString(), row.id],
    )

    toConsume -= deduction
    consumed.push({
      purchasedCreditId: row.id,
      bytes: deduction,
      free: row.intent_id === null,
    })
  }

  return consumed
}

// ---------------------------------------------------------------------------
// getRemainingCredits
// Single-query aggregate: total remaining bytes + nearest expiry, over all
// active rows and over purchased and free rows apart. The cap is enforced on
// the purchased figures only. Used by cap enforcement, the upload gate and
// the credits summary API endpoint.
// ---------------------------------------------------------------------------

const getRemainingCredits = async (
  accountId: string,
): Promise<PurchasedCreditSummary> => {
  const db = await getDatabase()
  const result = await db.query<{
    upload_bytes_remaining: string
    upload_bytes_original: string
    purchased_upload_bytes_remaining: string
    purchased_upload_bytes_original: string
    purchased_next_expiry: Date | null
    free_upload_bytes_remaining: string
    download_bytes_remaining: string
    next_expiry: Date | null
    active_row_count: string
  }>(
    `SELECT
       COALESCE(SUM(upload_bytes_remaining),   0) AS upload_bytes_remaining,
       COALESCE(SUM(upload_bytes_original),    0) AS upload_bytes_original,
       COALESCE(SUM(upload_bytes_remaining) FILTER (
         WHERE intent_id IS NOT NULL), 0) AS purchased_upload_bytes_remaining,
       COALESCE(SUM(upload_bytes_original) FILTER (
         WHERE intent_id IS NOT NULL), 0) AS purchased_upload_bytes_original,
       MIN(expires_at) FILTER (
         WHERE intent_id IS NOT NULL)     AS purchased_next_expiry,
       COALESCE(SUM(upload_bytes_remaining) FILTER (
         WHERE intent_id IS NULL), 0)     AS free_upload_bytes_remaining,
       COALESCE(SUM(download_bytes_remaining), 0) AS download_bytes_remaining,
       MIN(expires_at)                            AS next_expiry,
       COUNT(*) FILTER (WHERE intent_id IS NOT NULL) AS active_row_count
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
    uploadBytesOriginal: BigInt(row.upload_bytes_original),
    purchasedUploadBytesRemaining: BigInt(row.purchased_upload_bytes_remaining),
    purchasedUploadBytesOriginal: BigInt(row.purchased_upload_bytes_original),
    purchasedNextExpiryDate: row.purchased_next_expiry ?? null,
    freeUploadBytesRemaining: BigInt(row.free_upload_bytes_remaining),
    downloadBytesRemaining: BigInt(row.download_bytes_remaining),
    nextExpiryDate: row.next_expiry ?? null,
    activeRowCount: Number(row.active_row_count),
  }
}

// ---------------------------------------------------------------------------
// getExpiringCredits
// Returns active purchased rows expiring within N days. System-wide — no
// account filter. Free credits are left out: they owe no refund, and a
// partner's monthly free credits always expire within the month.
// ---------------------------------------------------------------------------

const getExpiringCredits = async (
  withinDays: number,
): Promise<PurchasedCredit[]> => {
  const db = await getDatabase()
  const result = await db.query<DBPurchasedCredit>(
    `SELECT *
     FROM purchased_credits
     WHERE intent_id IS NOT NULL
       AND expired = FALSE
       AND expires_at > NOW()
       AND expires_at <= NOW() + ($1 * INTERVAL '1 day')
       AND (upload_bytes_remaining > 0 OR download_bytes_remaining > 0)
     ORDER BY expires_at ASC`,
    [withinDays],
  )
  return result.rows.map(mapRow)
}

// ---------------------------------------------------------------------------
// getExpiringCreditsAggregate
// Single-query aggregate: count + byte sums for system-wide expiring purchased
// credits, for the admin /credits/economics endpoint. Free credits are left
// out, as in getExpiringCredits. Avoids transferring all rows into Node.js
// memory.
// ---------------------------------------------------------------------------

export type ExpiringCreditsAggregate = {
  count: number
  totalUploadBytesRemaining: bigint
  totalDownloadBytesRemaining: bigint
}

const getExpiringCreditsAggregate = async (
  withinDays: number,
): Promise<ExpiringCreditsAggregate> => {
  const db = await getDatabase()
  const result = await db.query<{
    count: string
    total_upload: string
    total_download: string
  }>(
    `SELECT
       COUNT(*)                                     AS count,
       COALESCE(SUM(upload_bytes_remaining),   0)  AS total_upload,
       COALESCE(SUM(download_bytes_remaining), 0)  AS total_download
     FROM purchased_credits
     WHERE intent_id IS NOT NULL
       AND expired = FALSE
       AND expires_at > NOW()
       AND expires_at <= NOW() + ($1 * INTERVAL '1 day')
       AND (upload_bytes_remaining > 0 OR download_bytes_remaining > 0)`,
    [withinDays],
  )

  const row = result.rows[0]
  return {
    count: Number(row.count),
    totalUploadBytesRemaining: BigInt(row.total_upload),
    totalDownloadBytesRemaining: BigInt(row.total_download),
  }
}

// ---------------------------------------------------------------------------
// getExpiringCreditsByAccountId
// Returns active rows for a specific account expiring within N days.
// Used by the per-user /credits/batches/expiring endpoint.
// ---------------------------------------------------------------------------

const getExpiringCreditsByAccountId = async (
  accountId: string,
  withinDays: number,
): Promise<PurchasedCredit[]> => {
  const db = await getDatabase()
  const result = await db.query<DBPurchasedCredit>(
    `SELECT *
     FROM purchased_credits
     WHERE account_id = $1
       AND expired = FALSE
       AND expires_at > NOW()
       AND expires_at <= NOW() + ($2 * INTERVAL '1 day')
       AND (upload_bytes_remaining > 0 OR download_bytes_remaining > 0)
     ORDER BY expires_at ASC`,
    [accountId, withinDays],
  )
  return result.rows.map(mapRow)
}

// ---------------------------------------------------------------------------
// markExpiredCredits
// Called by the credit expiry background job.
// Atomically marks rows whose expires_at has passed AND that still have
// remaining upload bytes, returning a summary of bytes forfeited for logging
// and metrics. Depleted rows (0 upload bytes remaining) are never marked
// expired: nothing was forfeited, the batch was simply used up, and flagging
// it as expired would incorrectly surface it to admins as awaiting a refund.
// Download bytes are deliberately ignored — they are not allocated, consumed
// or enforced anywhere in the app.
// ---------------------------------------------------------------------------

export type ExpiredCreditsSummary = {
  /** Purchased rows marked expired. */
  expiredCount: number
  totalUploadBytesForfeited: bigint
  totalDownloadBytesForfeited: bigint
  /** Free credit rows marked expired, kept apart: nothing was paid for them. */
  freeExpiredCount: number
  freeUploadBytesForfeited: bigint
}

const markExpiredCredits = async (): Promise<ExpiredCreditsSummary> => {
  const db = await getDatabase()
  const result = await db.query<{
    count: string
    upload_forfeited: string
    download_forfeited: string
    free_count: string
    free_upload_forfeited: string
  }>(
    `WITH expired AS (
       UPDATE purchased_credits
       SET expired = TRUE, updated_at = NOW()
       WHERE expired = FALSE
         AND expires_at <= NOW()
         AND upload_bytes_remaining > 0
       RETURNING intent_id, upload_bytes_remaining, download_bytes_remaining
     )
     SELECT
       COUNT(*) FILTER (WHERE intent_id IS NOT NULL) AS count,
       COALESCE(SUM(upload_bytes_remaining) FILTER (
         WHERE intent_id IS NOT NULL), 0)            AS upload_forfeited,
       COALESCE(SUM(download_bytes_remaining) FILTER (
         WHERE intent_id IS NOT NULL), 0)            AS download_forfeited,
       COUNT(*) FILTER (WHERE intent_id IS NULL)     AS free_count,
       COALESCE(SUM(upload_bytes_remaining) FILTER (
         WHERE intent_id IS NULL), 0)                AS free_upload_forfeited
     FROM expired`,
  )

  const row = result.rows[0]
  return {
    expiredCount: Number(row.count),
    totalUploadBytesForfeited: BigInt(row.upload_forfeited),
    totalDownloadBytesForfeited: BigInt(row.download_forfeited),
    freeExpiredCount: Number(row.free_count),
    freeUploadBytesForfeited: BigInt(row.free_upload_forfeited),
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
// createPurchasedCreditWithCapCheck
// Atomically checks the per-account cap and inserts a new credit row in a
// single transaction, using a PostgreSQL advisory lock keyed to the account
// to serialize concurrent calls. Returns err('cap_exceeded') if the purchase
// would push purchased upload remaining over the cap; free credits don't
// count toward it.
// The same transaction moves the intent from CONFIRMED to COMPLETED, and
// returns err('intent_not_confirmed') without inserting if it has left
// CONFIRMED, e.g. because the buyer's deletion expired it.
// Download bytes are not capped — they are not allocated on purchase right
// now (downloadBytesOriginal is expected to be 0n). Infrastructure is kept
// for future use.
// ---------------------------------------------------------------------------

const createPurchasedCreditWithCapCheck = async (
  params: CreatePurchasedCreditParams,
  maxBytesPerAccount: bigint,
): Promise<
  Result<PurchasedCredit, 'cap_exceeded' | 'intent_not_confirmed'>
> => {
  const db = await getDatabase()
  const client = await db.connect()

  try {
    await client.query('BEGIN')

    // Acquire a per-account advisory lock so concurrent onConfirmedIntent
    // calls for the same account are serialized. The lock is automatically
    // released when this transaction ends (commit or rollback).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      params.accountId,
    ])

    // Re-read the cap inside the lock — safe from concurrent modification.
    const currentResult = await client.query<{
      upload_bytes_remaining: string
      download_bytes_remaining: string
    }>(
      `SELECT
         COALESCE(SUM(upload_bytes_remaining),   0) AS upload_bytes_remaining,
         COALESCE(SUM(download_bytes_remaining), 0) AS download_bytes_remaining
       FROM purchased_credits
       WHERE account_id = $1
         AND intent_id IS NOT NULL
         AND expired = FALSE
         AND expires_at > NOW()
         AND (upload_bytes_remaining > 0 OR download_bytes_remaining > 0)`,
      [params.accountId],
    )

    const currentRow = currentResult.rows[0]
    const currentUpload = BigInt(currentRow.upload_bytes_remaining)

    if (currentUpload + params.uploadBytesOriginal > maxBytesPerAccount) {
      await client.query('ROLLBACK')
      return err('cap_exceeded' as const)
    }

    const completed = await intentsRepository.updateStatusIfConfirmed(
      params.intentId,
      IntentStatus.COMPLETED,
      client,
    )
    if (!completed) {
      await client.query('ROLLBACK')
      return err('intent_not_confirmed' as const)
    }

    const insertResult = await client.query<DBPurchasedCredit>(
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

    await client.query('COMMIT')
    return ok(mapRow(insertResult.rows[0]))
  } catch (error) {
    await client.query('ROLLBACK')
    logger.error(
      error,
      'createPurchasedCreditWithCapCheck: transaction failed, rolled back',
    )
    throw error
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Free credits
// Batches an admin grants a partner for free, with no intent. Monthly ones
// are issued lazily, once per UTC month and again when the monthly amount
// changes, and expire when the month ends; the partial unique index makes
// concurrent issuance a no-op.
// ---------------------------------------------------------------------------

// SQL for the start of the current UTC month, as a timestamp in UTC. Cast to
// date, it is the month's grant_period.
const CURRENT_MONTH = `date_trunc('month',
  NOW() AT TIME ZONE 'UTC')`

/**
 * Issues a partner account's monthly free credits for the current UTC month if
 * it has no current batch for it: its monthly amount less what the month's
 * earlier batches (replaced by a change to the amount) gave to uploads, if
 * that is more than 0. The amount is read from the account in the same
 * statement, so a request holding an older copy of the account can't issue
 * an amount an admin has just changed. The batch expires when the month ends.
 *
 * The account row is locked FOR SHARE before anything is inserted, against
 * updateAccount's FOR UPDATE: a change to the amount waits for a batch issued
 * here and then replaces it, and issuing waits for a change under way. The
 * foreign key would lock the row only after the insert, which can deadlock
 * with a change under way.
 */
const ensureMonthlyFreeCredits = async (
  accountId: string,
  client?: pg.PoolClient,
): Promise<void> => {
  const db = client ?? (await getDatabase())
  await db.query(
    `WITH monthly AS (
       SELECT monthly_free_upload_bytes AS bytes
       FROM accounts
       WHERE id = $1 AND is_partner
       FOR SHARE
     ), used AS (
       SELECT COALESCE(SUM(upload_bytes_original - upload_bytes_remaining), 0)
                AS bytes
       FROM purchased_credits
       WHERE account_id = $1 AND grant_period = ${CURRENT_MONTH}::date
     )
     INSERT INTO purchased_credits
       (account_id, upload_bytes_original, upload_bytes_remaining,
        download_bytes_original, download_bytes_remaining,
        purchased_at, expires_at, grant_period)
     SELECT $1, monthly.bytes - used.bytes, monthly.bytes - used.bytes, 0, 0,
            NOW(), (${CURRENT_MONTH} + interval '1 month') AT TIME ZONE 'UTC',
            ${CURRENT_MONTH}::date
     FROM monthly, used
     WHERE monthly.bytes - used.bytes > 0
     ON CONFLICT (account_id, grant_period)
       WHERE grant_period IS NOT NULL AND superseded_at IS NULL
     DO NOTHING`,
    [accountId],
  )
}

/**
 * Ends the account's current monthly free credits now, when the monthly amount
 * changes. Run in the transaction that changes it, before
 * ensureMonthlyFreeCredits, so the month's free credits become the new amount
 * less what has been used this month. The ended batch keeps its remaining
 * bytes, so usage reports count them as expired at this time.
 */
const supersedeMonthlyFreeCredits = async (
  client: pg.PoolClient,
  accountId: string,
): Promise<void> => {
  await client.query(
    `UPDATE purchased_credits
     SET superseded_at = NOW(),
         expires_at = LEAST(expires_at, NOW()),
         updated_at = NOW()
     WHERE account_id = $1
       AND grant_period = ${CURRENT_MONTH}::date
       AND superseded_at IS NULL`,
    [accountId],
  )
}

const createFreeCredit = async (params: {
  accountId: string
  uploadBytes: bigint
  expiresInDays: number
  grantedBy: string
  reason: string
}): Promise<AdminFreeCredit> => {
  const db = await getDatabase()
  const result = await db.query<DBPurchasedCredit>(
    `INSERT INTO purchased_credits
       (account_id, upload_bytes_original, upload_bytes_remaining,
        download_bytes_original, download_bytes_remaining,
        expires_at, granted_by, grant_reason)
     VALUES ($1, $2, $2, 0, 0, NOW() + ($3 * INTERVAL '1 day'), $4, $5)
     RETURNING *`,
    [
      params.accountId,
      params.uploadBytes.toString(),
      params.expiresInDays,
      params.grantedBy,
      params.reason,
    ],
  )
  return mapFreeCredit(result.rows[0])
}

/** The account's free batches, both kinds, newest first. */
const getFreeCreditsByAccountId = async (
  accountId: string,
): Promise<AdminFreeCredit[]> => {
  const db = await getDatabase()
  const result = await db.query<DBPurchasedCredit>(
    `SELECT *
     FROM purchased_credits
     WHERE account_id = $1 AND intent_id IS NULL
     ORDER BY purchased_at DESC, id`,
    [accountId],
  )
  return result.rows.map(mapFreeCredit)
}

// ---------------------------------------------------------------------------
// UUID guard
// purchased_credits.id is a UUID column; comparing it against a malformed
// string (or casting one via ::uuid[]) makes Postgres throw, which would
// surface as a 500. The use cases already reject non-UUID ids with 400, but
// the repository treats them as "not found" as well so no caller can
// trigger a cast error.
// ---------------------------------------------------------------------------

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// markAsRefunded
// Admin action: zero out remaining bytes for a single purchased_credits row
// and mark it as refunded, recording the on-chain transaction hash of the
// AI3 refund transfer and the upload bytes the refund took back.  Called after an admin has processed an out-of-band
// refund (manual AI3 transfer back to the user's wallet).
// Depleted rows (0 upload bytes remaining, never refunded) are rejected
// with notRefundable — nothing was forfeited, so no refund is owed on them.
// This mirrors the UI guard so the API cannot be used to record a refund on
// a used-up batch. Download bytes are deliberately ignored — they are not
// allocated, consumed or enforced anywhere in the app.
// Free credits are rejected with `free`: there was no payment to refund.
// Returns the updated row so the caller can echo it back to the client.
// Malformed (non-UUID) ids are reported as not found.
// ---------------------------------------------------------------------------

const markAsRefunded = async (
  id: string,
  refundTxHash: string,
): Promise<{
  found: boolean
  row: PurchasedCredit | null
  /** True when the row exists, is not refunded, but has 0 upload bytes left. */
  notRefundable?: boolean
  /** True when the row is free credits, which are never refunded. */
  free?: boolean
}> => {
  if (!UUID_REGEX.test(id)) {
    return { found: false, row: null }
  }

  const db = await getDatabase()
  const result = await db.query<DBPurchasedCredit>(
    `UPDATE purchased_credits
     SET refunded_upload_bytes    = upload_bytes_remaining,
         upload_bytes_remaining   = 0,
         download_bytes_remaining = 0,
         refunded_at              = NOW(),
         refund_tx_hash           = $2,
         updated_at               = NOW()
     WHERE id = $1
       AND intent_id IS NOT NULL
       AND refunded_at IS NULL
       AND upload_bytes_remaining > 0
     RETURNING *`,
    [id, refundTxHash],
  )

  if (result.rows[0]) {
    return { found: true, row: mapRow(result.rows[0]) }
  }

  const existing = await db.query<{
    id: string
    refunded_at: Date | null
    intent_id: string | null
  }>('SELECT id, refunded_at, intent_id FROM purchased_credits WHERE id = $1', [
    id,
  ])

  if (existing.rows.length === 0) {
    return { found: false, row: null }
  }
  if (existing.rows[0].intent_id === null) {
    return { found: true, row: null, free: true }
  }

  // Already refunded → idempotent no-op. Not refunded but skipped by the
  // UPDATE → fully depleted, no refund owed.
  if (existing.rows[0].refunded_at !== null) {
    return { found: true, row: null }
  }
  return { found: true, row: null, notRefundable: true }
}

// ---------------------------------------------------------------------------
// markManyAsRefunded
// Admin action: batch variant of markAsRefunded. Marks every given batch as
// refunded in a single transaction, recording the same on-chain refund
// transaction hash on each row (one AI3 transfer can cover several batches).
// All-or-nothing on existence: if any id does not exist the transaction is
// rolled back and missingIds is returned so the caller can 404 precisely.
// Likewise for free credits, which are never refunded: freeIds.
// All batches that are actually going to be refunded must belong to the
// SAME account AND have been paid from the SAME purchasing wallet (the
// intent's from_address) — one on-chain AI3 refund transfer goes back to a
// single wallet, so a combined refund spanning accounts or paying wallets
// is always a mistake. Rows that are already refunded are skipped
// (idempotent, mirroring the single-row behaviour) and keep their original
// tx hash, so they are excluded from both checks — a retry where everything
// is already refunded succeeds regardless. If the still-pending rows span
// multiple accounts or wallets the transaction is rolled back and
// accountIds / walletAddresses list the offenders so the caller can 400.
// Batches whose intent has no from_address recorded (legacy rows) are
// grouped under null: they can be combined with each other but not with
// batches paid from a known wallet.
// ---------------------------------------------------------------------------

export type BatchRefundResult = {
  missingIds: string[]
  /** Distinct account ids across the batches still pending refund. */
  accountIds: string[]
  /** Distinct paying wallets (intents.from_address) across pending rows. */
  walletAddresses: (string | null)[]
  refundedRows: PurchasedCredit[]
  alreadyRefundedIds: string[]
  /**
   * Ids of rows that are not refunded but depleted (0 upload bytes
   * remaining) — no refund is owed on them, so their presence rejects the
   * whole combined refund. Optional for backwards compatibility with
   * existing callers/mocks; absent means none.
   */
  nonRefundableIds?: string[]
  /** Ids of free credit rows, which are never refunded. Absent means none. */
  freeIds?: string[]
}

const markManyAsRefunded = async (
  ids: string[],
  refundTxHash: string,
): Promise<BatchRefundResult> => {
  // Malformed ids can never match a row; report them as missing instead of
  // letting the ::uuid[] cast throw (which would surface as a 500).
  const malformedIds = ids.filter((id) => !UUID_REGEX.test(id))
  if (malformedIds.length > 0) {
    return {
      missingIds: malformedIds,
      accountIds: [],
      walletAddresses: [],
      refundedRows: [],
      alreadyRefundedIds: [],
    }
  }

  const db = await getDatabase()
  const client = await db.connect()

  try {
    await client.query('BEGIN')

    // ORDER BY id makes the row locks acquire in a deterministic order so
    // two overlapping combined-refund transactions cannot deadlock by
    // locking the same rows in opposite orders. FOR UPDATE OF pc locks only
    // the purchased_credits rows, not the joined intents.
    const existing = await client.query<{
      id: string
      account_id: string
      intent_id: string | null
      refunded_at: Date | null
      upload_bytes_remaining: string
      from_address: string | null
    }>(
      `SELECT pc.id, pc.account_id, pc.intent_id, pc.refunded_at,
              pc.upload_bytes_remaining,
              i.from_address
       FROM purchased_credits pc
       LEFT JOIN intents i ON i.id = pc.intent_id
       WHERE pc.id = ANY($1::uuid[])
       ORDER BY pc.id
       FOR UPDATE OF pc`,
      [ids],
    )

    const existingIds = new Set(existing.rows.map((r) => r.id))
    const missingIds = ids.filter((id) => !existingIds.has(id))

    // Only rows still pending a refund are updated (and get the tx hash);
    // already-refunded rows are idempotent no-ops, so the single-account /
    // single-wallet constraints apply to the pending rows alone.
    const pendingRows = existing.rows.filter((r) => r.refunded_at === null)
    const accountIds = [...new Set(pendingRows.map((r) => r.account_id))]
    const walletAddresses = [...new Set(pendingRows.map((r) => r.from_address))]

    // Pending rows with no remaining upload bytes are depleted — nothing
    // was forfeited, so no refund is owed on them. Their presence rejects
    // the whole combined refund (all-or-nothing, like missing ids).
    const nonRefundableIds = pendingRows
      .filter((r) => BigInt(r.upload_bytes_remaining) === BigInt(0))
      .map((r) => r.id)

    if (missingIds.length > 0) {
      await client.query('ROLLBACK')
      return {
        missingIds,
        accountIds,
        walletAddresses,
        refundedRows: [],
        alreadyRefundedIds: [],
        nonRefundableIds,
      }
    }

    const freeIds = existing.rows
      .filter((r) => r.intent_id === null)
      .map((r) => r.id)
    if (freeIds.length > 0) {
      await client.query('ROLLBACK')
      return {
        missingIds: [],
        accountIds,
        walletAddresses,
        refundedRows: [],
        alreadyRefundedIds: [],
        freeIds,
      }
    }

    if (nonRefundableIds.length > 0) {
      await client.query('ROLLBACK')
      return {
        missingIds: [],
        accountIds,
        walletAddresses,
        refundedRows: [],
        alreadyRefundedIds: [],
        nonRefundableIds,
      }
    }

    if (accountIds.length > 1 || walletAddresses.length > 1) {
      await client.query('ROLLBACK')
      return {
        missingIds: [],
        accountIds,
        walletAddresses,
        refundedRows: [],
        alreadyRefundedIds: [],
        nonRefundableIds: [],
      }
    }

    const alreadyRefundedIds = existing.rows
      .filter((r) => r.refunded_at !== null)
      .map((r) => r.id)

    const updated = await client.query<DBPurchasedCredit>(
      `UPDATE purchased_credits
       SET refunded_upload_bytes    = upload_bytes_remaining,
           upload_bytes_remaining   = 0,
           download_bytes_remaining = 0,
           refunded_at              = NOW(),
           refund_tx_hash           = $2,
           updated_at               = NOW()
       WHERE id = ANY($1::uuid[])
         AND refunded_at IS NULL
       RETURNING *`,
      [ids, refundTxHash],
    )

    await client.query('COMMIT')
    return {
      missingIds: [],
      accountIds,
      walletAddresses,
      refundedRows: updated.rows.map(mapRow),
      alreadyRefundedIds,
      nonRefundableIds: [],
    }
  } catch (error) {
    await client.query('ROLLBACK')
    logger.error(error, 'markManyAsRefunded: transaction failed, rolled back')
    throw error
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// getByUserPublicId
// Admin view: all credit batches for a specific user (identified by their
// user_public_id), joined with the intent fields a refund is sized and sent
// from — asset, amount, wallet, and the quote a USDC charge was priced at.
// None of them can be recovered from purchased_credits, which records bytes
// and nothing about the money. Ordered newest-first.
// ---------------------------------------------------------------------------

type DBPurchasedCreditWithIntent = DBPurchasedCredit & {
  user_public_id: string
  payment_amount: string | null
  shannons_per_byte: string
  tx_hash: string | null
  from_address: string | null
  payment_method: PaymentMethod
  token_amount: string | null
  quoted_token_amount: string | null
  quoted_ai3_shannons: string | null
}

// Each field is documented on IntentSchema in @auto-drive/models; the notes
// here say only which of them carries the money on which asset.
export type AdminUserCreditBatchRow = PurchasedCredit & {
  userPublicId: string
  /** AI3 shannons received. NULL on a USDC purchase — see `tokenAmount`. */
  paymentAmount: bigint | null
  shannonsPerByte: bigint
  txHash: string | null
  fromAddress: string | null
  /** The asset paid. Refunds are always in AI3. */
  paymentMethod: PaymentMethod
  /** USDC base units received. May differ from the quote (AMOUNT_OFF_QUOTE). */
  tokenAmount: bigint | null
  /** USDC quoted; with `quotedAi3Shannons`, the rate actually charged. */
  quotedTokenAmount: bigint | null
  quotedAi3Shannons: bigint | null
}

const mapRowWithIntent = (
  row: DBPurchasedCreditWithIntent,
): AdminUserCreditBatchRow => ({
  ...mapRow(row),
  userPublicId: row.user_public_id,
  paymentAmount: row.payment_amount ? BigInt(row.payment_amount) : null,
  shannonsPerByte: BigInt(row.shannons_per_byte),
  txHash: row.tx_hash ?? null,
  fromAddress: row.from_address ?? null,
  paymentMethod: row.payment_method,
  tokenAmount: row.token_amount ? BigInt(row.token_amount) : null,
  quotedTokenAmount: row.quoted_token_amount
    ? BigInt(row.quoted_token_amount)
    : null,
  quotedAi3Shannons: row.quoted_ai3_shannons
    ? BigInt(row.quoted_ai3_shannons)
    : null,
})

// Batches joined to their intent, filtered on one column. Admin views select
// by buyer (`i.user_public_id`) or by the account credited
// (`pc.account_id`); the two differ once an organisation has several members.
const getWithIntentWhere = async (
  column: 'i.user_public_id' | 'pc.account_id',
  value: string,
): Promise<AdminUserCreditBatchRow[]> => {
  const db = await getDatabase()
  const result = await db.query<DBPurchasedCreditWithIntent>(
    `SELECT pc.*,
            i.user_public_id,
            i.payment_amount,
            i.shannons_per_byte,
            i.tx_hash,
            i.from_address,
            i.payment_method,
            i.token_amount,
            i.quoted_token_amount,
            i.quoted_ai3_shannons
     FROM purchased_credits pc
     JOIN intents i ON i.id = pc.intent_id
     WHERE ${column} = $1
     ORDER BY pc.purchased_at DESC`,
    [value],
  )
  return result.rows.map(mapRowWithIntent)
}

const getByUserPublicId = (userPublicId: string) =>
  getWithIntentWhere('i.user_public_id', userPublicId)

const getByAccountIdWithIntent = (accountId: string) =>
  getWithIntentWhere('pc.account_id', accountId)

// ---------------------------------------------------------------------------
// getAllWithUserPublicId
// Admin view: every credit batch across all users, joined with the
// user_public_id from the originating intent row. Ordered newest-first.
// ---------------------------------------------------------------------------

export type AdminCreditBatchRow = PurchasedCredit & {
  userPublicId: string
  /** EVM wallet that paid for the batch (intents.from_address), if known. */
  fromAddress: string | null
  /** Asset the batch was paid in; the wallet alone does not say which. */
  paymentMethod: PaymentMethod
}

const getAllWithUserPublicId = async (): Promise<AdminCreditBatchRow[]> => {
  const db = await getDatabase()
  const result = await db.query<
    DBPurchasedCredit & {
      user_public_id: string
      from_address: string | null
      payment_method: PaymentMethod
    }
  >(
    `SELECT pc.*, i.user_public_id, i.from_address, i.payment_method
     FROM purchased_credits pc
     JOIN intents i ON i.id = pc.intent_id
     ORDER BY pc.purchased_at DESC`,
  )
  return result.rows.map((row) => ({
    ...mapRow(row),
    userPublicId: row.user_public_id,
    fromAddress: row.from_address ?? null,
    paymentMethod: row.payment_method,
  }))
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
  getExpiringCreditsAggregate,
  getExpiringCreditsByAccountId,
  createPurchasedCreditWithCapCheck,
  ensureMonthlyFreeCredits,
  supersedeMonthlyFreeCredits,
  createFreeCredit,
  getFreeCreditsByAccountId,
  markExpiredCredits,
  getByAccountId,
  getAllWithUserPublicId,
  markAsRefunded,
  markManyAsRefunded,
  getByUserPublicId,
  getByAccountIdWithIntent,
}
