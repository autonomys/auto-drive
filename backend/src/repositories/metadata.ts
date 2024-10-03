import { OffchainMetadata } from "@autonomys/auto-drive";
import { getDatabase } from "../drivers/pg.js";

export interface MetadataEntry {
  cid: string;
  metadata: OffchainMetadata;
}

const getMetadata = async (cid: string): Promise<MetadataEntry | undefined> => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: "SELECT * FROM metadata WHERE cid = $1",
      values: [cid],
    })
    .then((entry) => {
      return entry.rows.length > 0 ? entry.rows[0] : undefined;
    });
};

const setMetadata = async (cid: string, metadata: OffchainMetadata) => {
  const db = await getDatabase();

  return db.query({
    text: "INSERT INTO metadata (cid, metadata) VALUES ($1, $2) ON CONFLICT (cid) DO UPDATE SET metadata = EXCLUDED.metadata",
    values: [cid, JSON.stringify(metadata)],
  });
};

const searchMetadataByCID = async (cid: string, limit: number | undefined) => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: "SELECT metadata.cid FROM metadata join object_ownership on metadata.cid = object_ownership.cid WHERE metadata.cid LIKE $1 LIMIT $2",
      values: [`%${cid}%`, limit],
    })
    .then((entries) => {
      return entries.rows.map((entry) => {
        return {
          cid: entry.cid,
        };
      });
    });
};

const searchMetadataByCIDAndUser = async (
  cid: string,
  limit: number | undefined,
  provider: string,
  userId: string
): Promise<string[]> => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: `
    SELECT m.* FROM metadata m
    JOIN object_ownership oo ON m.cid = oo.cid
    WHERE oo.oauth_provider = $1
    AND oo.oauth_user_id = $2
    AND oo.marked_as_deleted IS NULL
    AND m.cid LIKE $3
    LIMIT $4
    `,
      values: [provider, userId, `%${cid}%`, limit],
    })
    .then((entries) => entries.rows.map((entry) => entry.cid));
};

export const getAllMetadata = async () => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>("SELECT * FROM metadata")
    .then((entries) => entries.rows);
};

const getRootObjects = async () => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>(
      "SELECT m.* FROM metadata m join transaction_results tr on m.cid = tr.cid WHERE tr.head_cid = tr.cid"
    )
    .then((entries) => {
      return entries.rows.map((entry) => entry.cid);
    });
};

const getRootObjectsByUser = async (provider: string, userId: string) => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: "SELECT m.* FROM metadata m, transaction_results tr, object_ownership oo where m.cid = tr.cid and oo.cid = tr.cid and tr.head_cid = tr.cid and oo.oauth_provider = $1 and oo.oauth_user_id = $2 and oo.marked_as_deleted is null",
      values: [provider, userId],
    })
    .then((entries) => {
      return entries.rows.map((entry) => entry.cid);
    });
};

const getMetadataByUser = async (provider: string, userId: string) => {
  const db = await getDatabase();

  return db.query<MetadataEntry>({
    text: "SELECT * FROM metadata JOIN object_ownership ON metadata.cid = object_ownership.cid WHERE object_ownership.marked_as_deleted IS NULL AND object_ownership.oauth_provider = $1 AND object_ownership.oauth_user_id = $2",
    values: [provider, userId],
  });
};

export const metadataRepository = {
  getMetadata,
  setMetadata,
  getAllMetadata,
  searchMetadataByCID,
  searchMetadataByCIDAndUser,
  getRootObjects,
  getRootObjectsByUser,
  getMetadataByUser,
};
