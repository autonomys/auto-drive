import {
  PurchasedCredit,
  PurchasedCreditSummary,
} from '@auto-drive/models'
import { getDatabase } from '../../drivers/pg.js'
import { err, ok, Result } from 'neverthrow'
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
  refunded_at: Date | null
  refund_tx_hash: string | null
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
  refundedAt: row.refunded_at,
  refundTxHash: row.refund_tx_hash,
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
    upload_bytes_original: string
    download_bytes_remaining: string
    next_expiry: Date | null
    active_row_count: string
  }>(
    `SELECT
       COALESCE(SUM(upload_bytes_remaining),   0) AS upload_bytes_remaining,
       COALESCE(SUM(upload_bytes_original),    0) AS upload_bytes_original,
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
    uploadBytesOriginal: BigInt(row.upload_bytes_original),
    downloadBytesRemaining: BigInt(row.download_bytes_remaining),
    nextExpiryDate: row.next_expiry ?? null,
    activeRowCount: Number(row.active_row_count),
  }
}

// ---------------------------------------------------------------------------
// getExpiringCredits
// Returns active rows expiring within N days. System-wide — no account filter.
// Used by the admin /credits/economics endpoint for system-level monitoring.
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
// getExpiringCreditsAggregate
// Single-query aggregate: count + byte sums for system-wide expiring credits.
// Avoids transferring all rows into Node.js memory.
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
     WHERE expired = FALSE
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
// remaining bytes, returning a summary of bytes forfeited for logging and
// metrics. Fully depleted rows (0 upload + 0 download remaining) are never
// marked expired: nothing was forfeited, the batch was simply used up, and
// flagging it as expired would incorrectly surface it to admins as awaiting
// a refund.
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
         AND (upload_bytes_remaining > 0 OR download_bytes_remaining > 0)
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
// refundCredits
// Compensating transaction: adds bytes back to the account's active rows in
// FIFO order (soonest-expiry first), up to each row's original purchase
// amount. Called when interaction recording fails after consumeUpTo has
// already committed, to avoid permanent financial data loss.
// If not all bytes can be refunded (e.g. rows expired between consumption
// and the refund attempt), logs a warning but does not throw.
// ---------------------------------------------------------------------------

const refundCredits = async (
  accountId: string,
  creditType: 'upload' | 'download',
  bytes: bigint,
): Promise<void> => {
  if (bytes <= BigInt(0)) return

  const db = await getDatabase()
  const client = await db.connect()

  try {
    await client.query('BEGIN')

    const remainingCol =
      creditType === 'upload'
        ? 'upload_bytes_remaining'
        : 'download_bytes_remaining'

    // Lock in the same FIFO order as consumeUpTo so we refund to the rows
    // that were actually consumed from.
    const rowsResult = await client.query<DBPurchasedCredit>(
      `SELECT *
       FROM purchased_credits
       WHERE account_id = $1
         AND expired = FALSE
         AND expires_at > NOW()
       ORDER BY expires_at ASC, purchased_at ASC
       FOR UPDATE`,
      [accountId],
    )

    let toRefund = bytes

    for (const row of rowsResult.rows) {
      if (toRefund <= BigInt(0)) break

      const currentRemaining = BigInt(
        creditType === 'upload'
          ? row.upload_bytes_remaining
          : row.download_bytes_remaining,
      )
      const original = BigInt(
        creditType === 'upload'
          ? row.upload_bytes_original
          : row.download_bytes_original,
      )

      // Only refund up to the original purchase amount for this row.
      const capacity = original - currentRemaining
      if (capacity <= BigInt(0)) continue

      const refund = toRefund < capacity ? toRefund : capacity

      await client.query(
        `UPDATE purchased_credits
         SET ${remainingCol} = $1, updated_at = NOW()
         WHERE id = $2`,
        [(currentRemaining + refund).toString(), row.id],
      )

      toRefund -= refund
    }

    if (toRefund > BigInt(0)) {
      logger.warn(
        'refundCredits: could not fully refund %d bytes for account %s (rows may have expired)',
        toRefund,
        accountId,
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    logger.error(error, 'refundCredits: transaction failed, rolled back')
    throw error
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// createPurchasedCreditWithCapCheck
// Atomically checks the per-user cap and inserts a new credit row in a
// single transaction, using a PostgreSQL advisory lock keyed to the account
// to serialize concurrent calls. Returns err('cap_exceeded') if the purchase
// would push upload remaining over the cap.
// Download bytes are not capped — they are not allocated on purchase right
// now (downloadBytesOriginal is expected to be 0n). Infrastructure is kept
// for future use.
// ---------------------------------------------------------------------------

const createPurchasedCreditWithCapCheck = async (
  params: CreatePurchasedCreditParams,
  maxBytesPerUser: bigint,
): Promise<Result<PurchasedCredit, 'cap_exceeded'>> => {
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
         AND expired = FALSE
         AND expires_at > NOW()
         AND (upload_bytes_remaining > 0 OR download_bytes_remaining > 0)`,
      [params.accountId],
    )

    const currentRow = currentResult.rows[0]
    const currentUpload = BigInt(currentRow.upload_bytes_remaining)

    if (currentUpload + params.uploadBytesOriginal > maxBytesPerUser) {
      await client.query('ROLLBACK')
      return err('cap_exceeded' as const)
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
// AI3 refund transfer.  Called after an admin has processed an out-of-band
// refund (manual AI3 transfer back to the user's wallet).
// Fully depleted rows (0 upload + 0 download remaining, never refunded)
// are rejected with notRefundable — nothing was forfeited, so no refund is
// owed on them. This mirrors the UI guard so the API cannot be used to
// record a refund on a used-up batch.
// Returns the updated row so the caller can echo it back to the client.
// Malformed (non-UUID) ids are reported as not found.
// ---------------------------------------------------------------------------

const markAsRefunded = async (
  id: string,
  refundTxHash: string,
): Promise<{
  found: boolean
  row: PurchasedCredit | null
  /** True when the row exists, is not refunded, but has no remaining bytes. */
  notRefundable?: boolean
}> => {
  if (!UUID_REGEX.test(id)) {
    return { found: false, row: null }
  }

  const db = await getDatabase()
  const result = await db.query<DBPurchasedCredit>(
    `UPDATE purchased_credits
     SET upload_bytes_remaining   = 0,
         download_bytes_remaining = 0,
         refunded_at              = NOW(),
         refund_tx_hash           = $2,
         updated_at               = NOW()
     WHERE id = $1
       AND refunded_at IS NULL
       AND (upload_bytes_remaining > 0 OR download_bytes_remaining > 0)
     RETURNING *`,
    [id, refundTxHash],
  )

  if (result.rows[0]) {
    return { found: true, row: mapRow(result.rows[0]) }
  }

  const existing = await db.query<{
    id: string
    refunded_at: Date | null
  }>('SELECT id, refunded_at FROM purchased_credits WHERE id = $1', [id])

  if (existing.rows.length === 0) {
    return { found: false, row: null }
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
   * Ids of rows that are not refunded but fully depleted (0 upload +
   * 0 download remaining) — no refund is owed on them, so their presence
   * rejects the whole combined refund. Optional for backwards compatibility
   * with existing callers/mocks; absent means none.
   */
  nonRefundableIds?: string[]
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
      refunded_at: Date | null
      upload_bytes_remaining: string
      download_bytes_remaining: string
      from_address: string | null
    }>(
      `SELECT pc.id, pc.account_id, pc.refunded_at,
              pc.upload_bytes_remaining, pc.download_bytes_remaining,
              i.from_address
       FROM purchased_credits pc
       JOIN intents i ON i.id = pc.intent_id
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
    const walletAddresses = [
      ...new Set(pendingRows.map((r) => r.from_address)),
    ]

    // Pending rows with no remaining bytes are fully depleted — nothing was
    // forfeited, so no refund is owed on them. Their presence rejects the
    // whole combined refund (all-or-nothing, like missing ids).
    const nonRefundableIds = pendingRows
      .filter(
        (r) =>
          BigInt(r.upload_bytes_remaining) +
            BigInt(r.download_bytes_remaining) ===
          BigInt(0),
      )
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
       SET upload_bytes_remaining   = 0,
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
// user_public_id), joined with key fields from the originating intent so the
// admin page can show the AI3 price paid and the EVM wallet used.
// Ordered newest-first.
// ---------------------------------------------------------------------------

type DBPurchasedCreditWithIntent = DBPurchasedCredit & {
  user_public_id: string
  payment_amount: string | null
  shannons_per_byte: string
  tx_hash: string | null
  from_address: string | null
}

export type AdminUserCreditBatchRow = PurchasedCredit & {
  userPublicId: string
  paymentAmount: bigint | null
  shannonsPerByte: bigint
  txHash: string | null
  fromAddress: string | null
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
})

const getByUserPublicId = async (
  userPublicId: string,
): Promise<AdminUserCreditBatchRow[]> => {
  const db = await getDatabase()
  const result = await db.query<DBPurchasedCreditWithIntent>(
    `SELECT pc.*,
            i.user_public_id,
            i.payment_amount,
            i.shannons_per_byte,
            i.tx_hash,
            i.from_address
     FROM purchased_credits pc
     JOIN intents i ON i.id = pc.intent_id
     WHERE i.user_public_id = $1
     ORDER BY pc.purchased_at DESC`,
    [userPublicId],
  )
  return result.rows.map(mapRowWithIntent)
}

// ---------------------------------------------------------------------------
// getAllWithUserPublicId
// Admin view: every credit batch across all users, joined with the
// user_public_id from the originating intent row. Ordered newest-first.
// ---------------------------------------------------------------------------

export type AdminCreditBatchRow = PurchasedCredit & {
  userPublicId: string
  /** EVM wallet that paid for the batch (intents.from_address), if known. */
  fromAddress: string | null
}

const getAllWithUserPublicId = async (): Promise<AdminCreditBatchRow[]> => {
  const db = await getDatabase()
  const result = await db.query<
    DBPurchasedCredit & { user_public_id: string; from_address: string | null }
  >(
    `SELECT pc.*, i.user_public_id, i.from_address
     FROM purchased_credits pc
     JOIN intents i ON i.id = pc.intent_id
     ORDER BY pc.purchased_at DESC`,
  )
  return result.rows.map((row) => ({
    ...mapRow(row),
    userPublicId: row.user_public_id,
    fromAddress: row.from_address ?? null,
  }))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const purchasedCreditsRepository = {
  createPurchasedCredit,
  getActiveByAccountId,
  consumeUpTo,
  refundCredits,
  getRemainingCredits,
  getExpiringCredits,
  getExpiringCreditsAggregate,
  getExpiringCreditsByAccountId,
  createPurchasedCreditWithCapCheck,
  markExpiredCredits,
  getByAccountId,
  getAllWithUserPublicId,
  markAsRefunded,
  markManyAsRefunded,
  getByUserPublicId,
}
