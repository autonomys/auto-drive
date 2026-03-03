import { getDatabase } from '../../drivers/pg.js'
import { InteractionSource, InteractionType } from '@auto-drive/models'

type DBInteraction = {
  id: string
  account_id: string
  type: InteractionType
  size: string
  source: InteractionSource
  created_at: string | Date
}

type Interaction = Omit<DBInteraction, 'size' | 'created_at'> & {
  size: number
  createdAt: Date
  accountId: string
}

const mapRows = (rows: DBInteraction[]): Interaction[] => {
  return rows.map((e) => ({
    ...e,
    size: Number(e.size),
    createdAt: new Date(e.created_at),
    accountId: e.account_id,
  }))
}

const createInteraction = async (
  id: string,
  accountId: string,
  type: InteractionType,
  size: bigint,
  source: InteractionSource,
): Promise<Interaction> => {
  const db = await getDatabase()

  const interaction = await db.query<DBInteraction>(
    'INSERT INTO interactions (id, account_id, type, size, source) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, accountId, type, size.toString(), source],
  )

  return mapRows(interaction.rows)[0]
}

const getInteractionsByAccountIdAndTypeInTimeRange = async (
  accountId: string,
  type: InteractionType,
  start: Date,
  end: Date,
  source?: InteractionSource,
): Promise<Interaction[]> => {
  const db = await getDatabase()

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
  getInteractionsByAccountIdAndTypeInTimeRange,
}
