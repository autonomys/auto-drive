import { getDatabase } from "../drivers/pg.js";
import {
  Subscription,
  SubscriptionGranularity,
} from "../models/subscription.js";

type DBSubscription = {
  id: string;
  organization_id: string;
  granularity: SubscriptionGranularity;
  upload_limit: number;
  download_limit: number;
};

const mapRows = (rows: DBSubscription[]): Subscription[] => {
  return rows.map((row) => ({
    ...row,
    uploadLimit: Number(row.upload_limit),
    downloadLimit: Number(row.download_limit),
    organizationId: row.organization_id,
    granularity: row.granularity as SubscriptionGranularity,
  }));
};

const getByOrganizationId = async (
  organizationId: string
): Promise<Subscription | null> => {
  const db = await getDatabase();
  const result = await db.query<DBSubscription>(
    `SELECT * FROM subscriptions WHERE organization_id = $1`,
    [organizationId]
  );
  return mapRows(result.rows)[0] || null;
};

const createSubscription = async (
  id: string,
  organizationId: string,
  granularity: string,
  uploadLimit: number,
  downloadLimit: number
): Promise<Subscription> => {
  const db = await getDatabase();
  const result = await db.query<DBSubscription>(
    `INSERT INTO subscriptions (id, organization_id, granularity, "upload_limit", "download_limit") VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, organizationId, granularity, uploadLimit, downloadLimit]
  );
  return mapRows(result.rows)[0];
};

const updateSubscription = async (
  id: string,
  granularity: string,
  uploadLimit: number,
  downloadLimit: number
): Promise<Subscription> => {
  const db = await getDatabase();
  const result = await db.query<DBSubscription>(
    `UPDATE subscriptions SET granularity = $1, "upload_limit" = $2, "download_limit" = $3 WHERE id = $4`,
    [granularity, uploadLimit, downloadLimit, id]
  );
  return mapRows(result.rows)[0];
};

export const subscriptionsRepository = {
  getByOrganizationId,
  createSubscription,
  updateSubscription,
};
