import { getDatabase } from "../drivers/pg.js";
import { SubscriptionGranularity } from "../models/subscription.js";

type DBSubscription = {
  id: string;
  organization_id: string;
  granularity: SubscriptionGranularity;
  limit: number;
};

const getByOrganizationId = async (
  organizationId: string
): Promise<DBSubscription | null> => {
  const db = await getDatabase();
  const result = await db.query<DBSubscription>(
    `SELECT * FROM subscriptions WHERE organization_id = $1`,
    [organizationId]
  );
  return result.rows[0] || null;
};

const createSubscription = async (
  id: string,
  organizationId: string,
  granularity: string,
  limit: number
): Promise<DBSubscription> => {
  const db = await getDatabase();
  const result = await db.query<DBSubscription>(
    `INSERT INTO subscriptions (id, organization_id, granularity, limit) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, organizationId, granularity, limit]
  );
  return result.rows[0];
};

const updateSubscription = async (
  id: string,
  granularity: string,
  limit: number
): Promise<DBSubscription> => {
  const db = await getDatabase();
  const result = await db.query<DBSubscription>(
    `UPDATE subscriptions SET granularity = $1, limit = $2 WHERE id = $3`,
    [granularity, limit, id]
  );
  return result.rows[0];
};

export const subscriptionsRepository = {
  getByOrganizationId,
  createSubscription,
  updateSubscription,
};
