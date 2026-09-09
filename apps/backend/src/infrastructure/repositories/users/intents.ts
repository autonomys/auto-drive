import { getDatabase } from '../../drivers/pg.js'
import { Intent, IntentStatus, PaymentMethod } from '@auto-drive/models'

type DBIntent = {
  id: string
  user_public_id: string
  status: IntentStatus
  // Both NULLABLE in the DB (see 20250915125036-payments-up.sql), and typed that
  // way so the compiler keeps the coalescing below load-bearing. Declared as
  // plain `string` they were a lie the mapper could not see through: that is how
  // `txHash: row.tx_hash` type-checked while shipping `null`, which failed the
  // `intent.txHash !== undefined` replay exemption and filed every replay of a
  // hashless settled intent as a second payment.
  tx_hash: string | null
  payment_amount: string | null
  shannons_per_byte: string
  expires_at: Date | null
  from_address: string | null
  // NOT NULL in the DB (defaults to 'ai3_native'), so always present.
  payment_method: PaymentMethod
  // Token-payment columns: populated for USDC_ETH intents, NULL for AI3_NATIVE.
  token_amount: string | null
  quoted_token_amount: string | null
  // The AI3 amount the quote was priced for. With quoted_token_amount this is
  // the effective rate the confirmation path converts at.
  quoted_ai3_shannons: string | null
  usd_rate_at_creation: string | null
}

const mapRows = (rows: DBIntent[]): Intent[] => {
  return rows.map((row) => ({
    id: row.id,
    userPublicId: row.user_public_id,
    status: row.status,
    // `?? undefined`, like fromAddress and expiresAt below, and not merely for
    // consistency: the idempotency guard in markIntentAsConfirmed exempts rows
    // with no recorded hash by testing `intent.txHash !== undefined`, and a NULL
    // column arriving as `null` fails that test — so every replay of a row
    // settled before confirmations recorded a hash was filed as a second
    // payment. The comment there described the exemption; this makes it real.
    txHash: row.tx_hash ?? undefined,
    paymentAmount: row.payment_amount
      ? BigInt(row.payment_amount).valueOf()
      : undefined,
    shannonsPerByte: BigInt(row.shannons_per_byte).valueOf(),
    expiresAt: row.expires_at ?? undefined,
    fromAddress: row.from_address ?? undefined,
    paymentMethod: row.payment_method,
    tokenAmount: row.token_amount
      ? BigInt(row.token_amount).valueOf()
      : undefined,
    quotedTokenAmount: row.quoted_token_amount
      ? BigInt(row.quoted_token_amount).valueOf()
      : undefined,
    quotedAi3Shannons: row.quoted_ai3_shannons
      ? BigInt(row.quoted_ai3_shannons).valueOf()
      : undefined,
    usdRateAtCreation: row.usd_rate_at_creation
      ? BigInt(row.usd_rate_at_creation).valueOf()
      : undefined,
  }))
}

const getById = async (id: string): Promise<Intent | null> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    'SELECT * FROM intents WHERE id = $1',
    [id],
  )
  return mapRows(result.rows)[0] || null
}

const createIntent = async (intent: Intent): Promise<Intent> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    `INSERT INTO intents
       (id, user_public_id, status, tx_hash, payment_amount, shannons_per_byte,
        expires_at, payment_method, token_amount, quoted_token_amount,
        quoted_ai3_shannons, usd_rate_at_creation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      intent.id,
      intent.userPublicId,
      intent.status,
      intent.txHash ?? null,
      intent.paymentAmount?.toString() ?? null,
      intent.shannonsPerByte,
      intent.expiresAt ?? null,
      // payment_method is NOT NULL; default to native AI3 when unset (the USDC
      // creation flow sets it explicitly).
      intent.paymentMethod ?? PaymentMethod.AI3_NATIVE,
      intent.tokenAmount?.toString() ?? null,
      intent.quotedTokenAmount?.toString() ?? null,
      intent.quotedAi3Shannons?.toString() ?? null,
      intent.usdRateAtCreation?.toString() ?? null,
    ],
  )
  return mapRows(result.rows)[0]
}

const updateIntent = async (intent: Intent): Promise<Intent> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    `UPDATE intents
     SET status = $1, user_public_id = $2, tx_hash = $3,
         payment_amount = $4, shannons_per_byte = $5, expires_at = $6,
         from_address = $7, payment_method = $8, token_amount = $9,
         quoted_token_amount = $10, quoted_ai3_shannons = $11,
         usd_rate_at_creation = $12
     WHERE id = $13
     RETURNING *`,
    [
      intent.status,
      intent.userPublicId,
      intent.txHash ?? null,
      intent.paymentAmount?.toString() ?? null,
      intent.shannonsPerByte,
      intent.expiresAt ?? null,
      intent.fromAddress ?? null,
      // Callers load the intent (getById → mapRows) and spread it before
      // updating, so these round-trip unchanged unless explicitly overridden.
      // This statement rewrites the full column list, so a column missing here
      // is silently nulled on every status transition.
      intent.paymentMethod ?? PaymentMethod.AI3_NATIVE,
      intent.tokenAmount?.toString() ?? null,
      intent.quotedTokenAmount?.toString() ?? null,
      intent.quotedAi3Shannons?.toString() ?? null,
      intent.usdRateAtCreation?.toString() ?? null,
      intent.id,
    ],
  )
  return mapRows(result.rows)[0]
}

/**
 * Move a PENDING intent to CONFIRMED, only if it is still PENDING. Returns the
 * updated row, or null if the status had already moved on.
 *
 * Conditional for the same reason expireIntentIfPending is: markIntentAsConfirmed
 * reads the intent, decides, and writes, and watchTransaction issues one call per
 * parsed log inside a Promise.all. Two payments for the same intent in one
 * transaction therefore both read PENDING before either writes, and an
 * unconditional UPDATE by id let the second overwrite the first — one amount
 * credited, the other gone, and neither call able to tell that it had raced.
 * Losing this UPDATE is how the caller learns to file the payment instead.
 *
 * Sets only the confirmation columns, rather than rewriting the row from a
 * snapshot the way updateIntent does. The quote columns are what credits are
 * derived from, and a stale snapshot must not be able to null them.
 */
const confirmIntentIfPending = async ({
  id,
  paymentAmount,
  tokenAmount,
  fromAddress,
  txHash,
}: {
  id: string
  paymentAmount?: bigint
  tokenAmount?: bigint
  fromAddress?: string
  txHash?: string
}): Promise<Intent | null> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    `UPDATE intents
        SET status = $2,
            payment_amount = COALESCE($3::numeric, payment_amount),
            token_amount = COALESCE($4::numeric, token_amount),
            from_address = COALESCE($5::text, from_address),
            tx_hash = COALESCE($6::text, tx_hash)
      WHERE id = $1
        AND status = $7
      RETURNING *`,
    [
      id,
      IntentStatus.CONFIRMED,
      paymentAmount?.toString() ?? null,
      tokenAmount?.toString() ?? null,
      fromAddress ?? null,
      txHash ?? null,
      IntentStatus.PENDING,
    ],
  )
  return mapRows(result.rows)[0] ?? null
}

/**
 * Record the transaction a user says they paid with, only while the intent is
 * still PENDING. Returns false if the status had already moved on.
 *
 * Conditional, and touching one column, for the same reason confirmIntentIfPending
 * is: triggerWatchIntent reads the intent through getIntent and then wrote the
 * whole row back from that snapshot. A confirmation landing in between was undone
 * by it — status reverted to PENDING and payment_amount nulled — so a payment that
 * had already been credited became uncredited, and stayed that way until a restart
 * re-watched the row.
 */
const setTxHashIfPending = async (
  intentId: string,
  txHash: string,
): Promise<boolean> => {
  const db = await getDatabase()
  const result = await db.query(
    `UPDATE intents
        SET tx_hash = $2
      WHERE id = $1
        AND status = $3`,
    [intentId, txHash, IntentStatus.PENDING],
  )
  return (result.rowCount ?? 0) > 0
}

const getByStatus = async (status: IntentStatus): Promise<Intent[]> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    'SELECT * FROM intents WHERE status = $1',
    [status],
  )
  return mapRows(result.rows)
}

// Returns PENDING intents whose price-lock window has passed and that cleanup
// should reclaim.
//
// Two cases, because a tx_hash means two different things depending on how long
// ago it was written:
//
//   • No tx_hash: no transaction was ever submitted. Expired as soon as
//     expires_at passes, as before.
//   • A tx_hash older than expires_at + graceMinutes: a hash that is not going
//     to resolve. The exclusion this replaces assumed a tx_hash means "actively
//     being watched and will resolve"; a payment the watcher refused is a
//     standing counterexample, and so is a transaction that never confirms. Left
//     out, those rows can reach neither EXPIRED nor CONFIRMED: getIntent keeps
//     serving them as payable indefinitely past their price lock, and the startup
//     sweep re-watches them on every restart.
//
// A hash inside the grace window is still exempt, so the ordinary
// slow-confirmation case resolves through markIntentAsConfirmed untouched.
const getExpiredPendingIntents = async (
  graceMinutes: number,
): Promise<Intent[]> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    `SELECT * FROM intents
     WHERE status = $1
       AND expires_at IS NOT NULL
       AND (
         (tx_hash IS NULL AND expires_at < NOW())
         OR expires_at < NOW() - ($2::text || ' minutes')::interval
       )`,
    [IntentStatus.PENDING, graceMinutes],
  )
  return mapRows(result.rows)
}

// Atomically marks a single intent as EXPIRED only if it is still PENDING.
// Returns true if the row was updated, false if the status had already changed
// (e.g. concurrent markIntentAsConfirmed promoted it to CONFIRMED).
// This prevents the TOCTOU race where a stale read-then-write could overwrite
// a CONFIRMED status and its paymentAmount.
const expireIntentIfPending = async (intentId: string): Promise<boolean> => {
  const db = await getDatabase()
  const result = await db.query(
    `UPDATE intents
     SET status = $1
     WHERE id = $2 AND status = $3`,
    [IntentStatus.EXPIRED, intentId, IntentStatus.PENDING],
  )
  return (result.rowCount ?? 0) > 0
}

// Returns PENDING intents that already have an on-chain tx_hash, for one
// payment method.
// These are intents where the user submitted a transaction but the payment
// manager did not process the confirmation event — typically because the
// service was restarted or the EVM RPC was temporarily unavailable.
// Used by the startup recovery sweep so that no paid transaction is silently
// abandoned across a service restart.
//
// The payment method is required rather than optional because each chain's
// watcher can only resolve its own hashes: handed an Ethereum hash, the Auto EVM
// client does not fail, it waits out its receipt timeout. An unfiltered version
// of this query would therefore be correct for neither caller, so there is no
// safe default to offer.
//
// payment_method is NOT NULL with an 'ai3_native' default, so every row written
// before the column existed is returned by the AI3 sweep.
const getPendingWithTxHash = async (
  paymentMethod: PaymentMethod,
): Promise<Intent[]> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    `SELECT * FROM intents
     WHERE status = $1
       AND tx_hash IS NOT NULL
       AND payment_method = $2`,
    [IntentStatus.PENDING, paymentMethod],
  )
  return mapRows(result.rows)
}

// Returns all intents that were blocked by the per-user cap.
// These are terminal — the polling loop skips them — and require admin review.
const getOverCapIntents = async (): Promise<Intent[]> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    'SELECT * FROM intents WHERE status = $1 ORDER BY id',
    [IntentStatus.OVER_CAP],
  )
  return mapRows(result.rows)
}

export const intentsRepository = {
  getById,
  createIntent,
  updateIntent,
  confirmIntentIfPending,
  setTxHashIfPending,
  getByStatus,
  getExpiredPendingIntents,
  expireIntentIfPending,
  getOverCapIntents,
  getPendingWithTxHash,
}
