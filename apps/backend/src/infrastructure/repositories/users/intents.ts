import { getDatabase } from '../../drivers/pg.js'
import { Intent, IntentStatus, PaymentMethod } from '@auto-drive/models'

type DBIntent = {
  id: string
  user_public_id: string
  status: IntentStatus
  tx_hash: string
  payment_amount: string
  shannons_per_byte: string
  expires_at: Date | null
  from_address: string | null
  // NOT NULL in the DB (defaults to 'ai3_native'), so always present.
  payment_method: PaymentMethod
  // Token-payment columns: populated for USDC_ETH intents, NULL for AI3_NATIVE.
  token_amount: string | null
  quoted_token_amount: string | null
  usd_rate_at_creation: string | null
}

const mapRows = (rows: DBIntent[]): Intent[] => {
  return rows.map((row) => ({
    id: row.id,
    userPublicId: row.user_public_id,
    status: row.status,
    txHash: row.tx_hash,
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
        usd_rate_at_creation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
         quoted_token_amount = $10, usd_rate_at_creation = $11
     WHERE id = $12
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
      intent.paymentMethod ?? PaymentMethod.AI3_NATIVE,
      intent.tokenAmount?.toString() ?? null,
      intent.quotedTokenAmount?.toString() ?? null,
      intent.usdRateAtCreation?.toString() ?? null,
      intent.id,
    ],
  )
  return mapRows(result.rows)[0]
}

const getByStatus = async (status: IntentStatus): Promise<Intent[]> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    'SELECT * FROM intents WHERE status = $1',
    [status],
  )
  return mapRows(result.rows)
}

// Returns PENDING intents whose expires_at has passed and that have no
// tx_hash — i.e. no on-chain transaction was submitted yet. Intents with a
// tx_hash are actively being watched and must not be expired by cleanup;
// their resolution comes from the on-chain watcher (markIntentAsConfirmed).
const getExpiredPendingIntents = async (): Promise<Intent[]> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    `SELECT * FROM intents
     WHERE status = $1
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
       AND tx_hash IS NULL`,
    [IntentStatus.PENDING],
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

// Returns PENDING intents that already have an on-chain tx_hash.
// These are intents where the user submitted a transaction but the payment
// manager did not process the confirmation event — typically because the
// service was restarted or the EVM RPC was temporarily unavailable.
// Used by the startup recovery sweep so that no paid transaction is silently
// abandoned across a service restart.
const getPendingWithTxHash = async (): Promise<Intent[]> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    `SELECT * FROM intents
     WHERE status = $1
       AND tx_hash IS NOT NULL`,
    [IntentStatus.PENDING],
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
  getByStatus,
  getExpiredPendingIntents,
  expireIntentIfPending,
  getOverCapIntents,
  getPendingWithTxHash,
}
