import { getDatabase } from "../drivers/pg.js";
import { InteractionType } from "../models/interactions.js";

type Interaction = {
  id: string;
  subscription_id: string;
  type: InteractionType;
  size: number;
};

const createInteraction = async (
  id: string,
  type: InteractionType,
  size: number
): Promise<Interaction> => {
  const db = await getDatabase();

  const interaction = await db.query(
    "INSERT INTO interactions (id, type, size) VALUES ($1, $2, $3) RETURNING *",
    [id, type, size]
  );

  return interaction.rows[0];
};

const getInteractionsBySubscriptionIdAndTypeInTimeRange = async (
  subscriptionId: string,
  type: InteractionType,
  start: Date,
  end: Date
): Promise<Interaction[]> => {
  const db = await getDatabase();

  const interactions = await db.query(
    "SELECT * FROM interactions WHERE subscription_id = $1 AND type = $2 AND created_at >= $3 AND created_at <= $4",
    [subscriptionId, type, start, end]
  );

  return interactions.rows;
};

export const interactionsRepository = {
  createInteraction,
  getInteractionsBySubscriptionIdAndTypeInTimeRange,
};
