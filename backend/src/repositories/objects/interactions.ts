import { getDatabase } from '../../drivers/pg.js'
import { InteractionType } from '@auto-drive/models'

type DBInteraction = {
  id: string
  subscription_id: string
  type: InteractionType
  size: string
  created_at: string | Date
}

type Interaction = Omit<DBInteraction, 'size' | 'created_at'> & {
  size: number
  createdAt: Date
}

const mapRows = (rows: DBInteraction[]): Interaction[] => {
  return rows.map((e) => ({
    ...e,
    size: Number(e.size),
    createdAt: new Date(e.created_at),
  }))
}

const createInteraction = async (
  id: string,
  subscription_id: string,
  type: InteractionType,
  size: bigint,
): Promise<Interaction> => {
  const db = await getDatabase()

  const interaction = await db.query<DBInteraction>(
    'INSERT INTO interactions (id, subscription_id, type, size) VALUES ($1, $2, $3, $4) RETURNING *',
    [id, subscription_id, type, size.toString()],
  )

  return mapRows(interaction.rows)[0]
}

const getInteractionsBySubscriptionIdAndTypeInTimeRange = async (
  subscriptionId: string,
  type: InteractionType,
  start: Date,
  end: Date,
): Promise<Interaction[]> => {
  const db = await getDatabase()

  const interactions = await db.query<DBInteraction>(
    'SELECT * FROM interactions WHERE subscription_id = $1 AND type = $2 AND created_at >= $3 AND created_at <= $4',
    [subscriptionId, type, start.toISOString(), end.toISOString()],
  )

  return mapRows(interactions.rows)
}

export const interactionsRepository = {
  createInteraction,
  getInteractionsBySubscriptionIdAndTypeInTimeRange,
}
