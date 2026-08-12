import { getDatabase } from '../../drivers/pg.js'
import {
  IntentMispayment,
  IntentMispaymentReason,
  PaymentMethod,
} from '@auto-drive/models'

type DBIntentMispayment = {
  id: string
  intent_id: string
  reason: IntentMispaymentReason
  expected_payment_method: PaymentMethod | null
  payment_amount: string | null
  token_amount: string | null
  from_address: string | null
  tx_hash: string | null
  created_at: Date
}

const mapRows = (rows: DBIntentMispayment[]): IntentMispayment[] => {
  return rows.map((row) => ({
    // bigserial arrives as a string from pg and stays one: it is an identifier,
    // never arithmetic.
    id: row.id,
    intentId: row.intent_id,
    reason: row.reason,
    expectedPaymentMethod: row.expected_payment_method ?? undefined,
    paymentAmount: row.payment_amount
      ? BigInt(row.payment_amount).valueOf()
      : undefined,
    tokenAmount: row.token_amount
      ? BigInt(row.token_amount).valueOf()
      : undefined,
    fromAddress: row.from_address ?? undefined,
    txHash: row.tx_hash ?? undefined,
    createdAt: row.created_at,
  }))
}

/**
 * Record a refused payment. Returns the stored row, or null when this
 * (transaction, intent) pair was already recorded.
 *
 * ON CONFLICT DO NOTHING because the watcher replays: reorgs re-emit events and
 * the startup sweep re-runs every PENDING intent that carries a tx_hash. A
 * mispayment is one fact about one transfer, so a second sighting must not
 * become a second row — an admin queue that grows on every restart is one nobody
 * reads.
 *
 * A payment with no tx_hash cannot be de-duplicated (NULLs are distinct in the
 * index) and will insert again on replay. Every production caller has the hash;
 * the parameter is optional only because the use case cannot require what its
 * signature does not guarantee.
 */
const record = async (
  mispayment: Omit<IntentMispayment, 'id' | 'createdAt'>,
): Promise<IntentMispayment | null> => {
  const db = await getDatabase()
  const result = await db.query<DBIntentMispayment>(
    `INSERT INTO intent_mispayments
       (intent_id, reason, expected_payment_method, payment_amount,
        token_amount, from_address, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      mispayment.intentId,
      mispayment.reason,
      mispayment.expectedPaymentMethod ?? null,
      mispayment.paymentAmount?.toString() ?? null,
      mispayment.tokenAmount?.toString() ?? null,
      mispayment.fromAddress ?? null,
      mispayment.txHash ?? null,
    ],
  )
  return mapRows(result.rows)[0] ?? null
}

// Newest first: an admin working this queue is working the most recent
// incident, and the oldest rows are the ones already resolved out-of-band.
const list = async (limit = 200): Promise<IntentMispayment[]> => {
  const db = await getDatabase()
  const result = await db.query<DBIntentMispayment>(
    `SELECT * FROM intent_mispayments
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [limit],
  )
  return mapRows(result.rows)
}

export const intentMispaymentsRepository = {
  record,
  list,
}
