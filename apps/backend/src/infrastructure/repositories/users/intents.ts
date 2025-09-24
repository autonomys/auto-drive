import { getDatabase } from '../../drivers/pg.js'
import { Intent, IntentStatus } from '@auto-drive/models'

type DBIntent = {
  id: string
  user_public_id: string
  status: IntentStatus
  tx_hash: string
  payment_amount: string
  price_per_mb: number
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
    pricePerMB: row.price_per_mb,
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
    'INSERT INTO intents (id, user_public_id, status, tx_hash, payment_amount, price_per_mb) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [
      intent.id,
      intent.userPublicId,
      intent.status,
      intent.txHash ?? null,
      intent.paymentAmount?.toString() ?? null,
      intent.pricePerMB,
    ],
  )
  return mapRows(result.rows)[0]
}

const updateIntent = async (intent: Intent): Promise<Intent> => {
  const db = await getDatabase()
  const result = await db.query<DBIntent>(
    'UPDATE intents SET status = $1, user_public_id = $2, tx_hash = $3, payment_amount = $4, price_per_mb = $5 WHERE id = $6 RETURNING *',
    [
      intent.status,
      intent.userPublicId,
      intent.txHash ?? null,
      intent.paymentAmount?.toString() ?? null,
      intent.pricePerMB,
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

export const intentsRepository = {
  getById,
  createIntent,
  updateIntent,
  getByStatus,
}
