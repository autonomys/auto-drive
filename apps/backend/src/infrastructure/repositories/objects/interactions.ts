import pg from 'pg'
import { getDatabase } from '../../drivers/pg.js'
import { InteractionSource, InteractionType } from '@auto-drive/models'

type DBInteraction = {
  id: string
  account_id: string
  type: InteractionType
  size: string
  source: InteractionSource
  cid: string | null
  api_key_id: string | null
  created_at: string | Date
}

type Interaction = Omit<DBInteraction, 'size' | 'created_at'> & {
  size: number
  createdAt: Date
  accountId: string
  cid: string | null
}

// A pool, or a client holding an open transaction.
type Executor = pg.Pool | pg.PoolClient

const mapRows = (rows: DBInteraction[]): Interaction[] => {
  return rows.map((e) => ({
    ...e,
    size: Number(e.size),
    createdAt: new Date(e.created_at),
    accountId: e.account_id,
    cid: e.cid ?? null,
  }))
}

const createInteraction = async (
  id: string,
  accountId: string,
  type: InteractionType,
  size: bigint,
  source: InteractionSource,
  cid?: string,
  apiKeyId?: string,
  executor?: Executor,
): Promise<Interaction> => {
  const db = executor ?? (await getDatabase())

  const interaction = await db.query<DBInteraction>(
    'INSERT INTO interactions (id, account_id, type, size, source, cid, api_key_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [
      id,
      accountId,
      type,
      size.toString(),
      source,
      cid ?? null,
      apiKeyId ?? null,
    ],
  )

  return mapRows(interaction.rows)[0]
}

const createCreditConsumption = async (
  interactionId: string,
  consumption: { purchasedCreditId: string; bytes: bigint }[],
  executor: Executor,
): Promise<void> => {
  if (consumption.length === 0) return

  await executor.query(
    `INSERT INTO interaction_credit_consumption (interaction_id, purchased_credit_id, bytes)
     SELECT $1, * FROM UNNEST($2::uuid[], $3::int8[])`,
    [
      interactionId,
      consumption.map((c) => c.purchasedCreditId),
      consumption.map((c) => c.bytes.toString()),
    ],
  )
}

const getInteractionsByAccountIdAndTypeInTimeRange = async (
  accountId: string,
  type: InteractionType,
  start: Date,
  end: Date,
  source?: InteractionSource,
  executor?: Executor,
): Promise<Interaction[]> => {
  const db = executor ?? (await getDatabase())

  const interactions = await db.query<DBInteraction>(
    `SELECT * FROM interactions
     WHERE account_id = $1
       AND type = $2
       AND created_at >= $3
       AND created_at <= $4
       ${source ? 'AND source = $5' : ''}`,
    source
      ? [accountId, type, start.toISOString(), end.toISOString(), source]
      : [accountId, type, start.toISOString(), end.toISOString()],
  )

  return mapRows(interactions.rows)
}

export const interactionsRepository = {
  createInteraction,
  createCreditConsumption,
  getInteractionsByAccountIdAndTypeInTimeRange,
}
