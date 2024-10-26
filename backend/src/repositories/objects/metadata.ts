import { OffchainMetadata } from "@autonomys/auto-drive";
import { getDatabase } from "../../drivers/pg.js";

export interface MetadataEntry {
  root_cid: string;
  head_cid: string;
  metadata: OffchainMetadata;
}

const getMetadata = async (cid: string): Promise<MetadataEntry | undefined> => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: "SELECT * FROM metadata WHERE head_cid = $1",
      values: [cid],
    })
    .then((entry) => {
      return entry.rows.length > 0 ? entry.rows[0] : undefined;
    });
};

const setMetadata = async (
  rootCid: string,
  headCid: string,
  metadata: OffchainMetadata
) => {
  const db = await getDatabase();

  return db.query({
    text: "INSERT INTO metadata (root_cid, head_cid, metadata) VALUES ($1, $2, $3) ON CONFLICT (root_cid, head_cid) DO UPDATE SET metadata = EXCLUDED.metadata",
    values: [rootCid, headCid, JSON.stringify(metadata)],
  });
};

const searchMetadataByCID = async (
  cid: string,
  limit: number | undefined
): Promise<MetadataEntry[]> => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: "SELECT metadata.* FROM metadata join object_ownership on metadata.head_cid = object_ownership.cid WHERE metadata.head_cid LIKE $1 LIMIT $2",
      values: [`%${cid}%`, limit],
    })
    .then((entries) => entries.rows);
};

const searchMetadataByCIDAndUser = async (
  cid: string,
  limit: number | undefined,
  provider: string,
  userId: string
): Promise<MetadataEntry[]> => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: `
    SELECT m.* FROM metadata m
    JOIN object_ownership oo ON m.head_cid = oo.cid
    WHERE oo.oauth_provider = $1
    AND oo.oauth_user_id = $2
    AND oo.marked_as_deleted IS NULL
    AND m.head_cid LIKE $3
    LIMIT $4
    `,
      values: [provider, userId, `%${cid}%`, limit],
    })
    .then((entries) => entries.rows);
};

const searchMetadataByNameAndUser = async (
  query: string,
  provider: string,
  userId: string,
  limit: number
): Promise<MetadataEntry[]> => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: `
      SELECT m.* FROM metadata m
    JOIN object_ownership oo ON m.head_cid = oo.cid
    WHERE oo.oauth_provider = $1
    AND oo.oauth_user_id = $2
    AND oo.marked_as_deleted IS NULL
    AND m.metadata->>'name' ILIKE $3
    LIMIT $4`,
      values: [provider, userId, `%${query}%`, limit],
    })
    .then((entries) => entries.rows);
};

const searchMetadataByName = async (query: string, limit: number) => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: "SELECT * FROM metadata WHERE metadata->>'name' ILIKE $1 LIMIT $2",
      values: [`%${query}%`, limit],
    })
    .then((entries) => entries.rows);
};

const getAllMetadata = async () => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>("SELECT * FROM metadata")
    .then((entries) => entries.rows);
};

const getMetadataByRootCid = async (rootCid: string) => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>("SELECT * FROM metadata WHERE root_cid = $1", [
      rootCid,
    ])
    .then((entries) => entries.rows);
};

const getRootObjects = async () => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>(
      `with root_objects as (
        SELECT m.* 
        FROM metadata m 
        WHERE m.root_cid = m.head_cid
      )
      SELECT root_objects.head_cid 
      FROM root_objects
      INNER JOIN object_ownership oo ON root_objects.head_cid = oo.cid 
      WHERE oo.marked_as_deleted IS NULL 
      GROUP BY root_objects.head_cid`
    )
    .then((entries) => {
      return entries.rows.map((entry) => entry.head_cid);
    });
};

const getRootObjectsByUser = async (provider: string, userId: string) => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: "SELECT m.* FROM metadata m join object_ownership oo on m.root_cid = oo.cid where m.root_cid = m.head_cid and oo.oauth_provider = $1 and oo.oauth_user_id = $2 and oo.is_admin is true and oo.marked_as_deleted is null",
      values: [provider, userId],
    })
    .then((entries) => {
      return entries.rows.map((entry) => entry.head_cid);
    });
};

const getSharedRootObjectsByUser = async (provider: string, userId: string) => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: "SELECT m.* FROM metadata m join object_ownership oo on m.root_cid = oo.cid where m.root_cid = m.head_cid and oo.oauth_provider = $1 and oo.oauth_user_id = $2 and oo.is_admin is false and oo.marked_as_deleted is null",
      values: [provider, userId],
    })
    .then((entries) => {
      return entries.rows.map((entry) => entry.head_cid);
    });
};

const getMarkedAsDeletedRootObjectsByUser = async (
  provider: string,
  userId: string
) => {
  const db = await getDatabase();

  return db
    .query<MetadataEntry>({
      text: "SELECT m.* FROM metadata m join object_ownership oo on m.root_cid = oo.cid where m.root_cid = m.head_cid and oo.oauth_provider = $1 and oo.oauth_user_id = $2 and oo.marked_as_deleted is not null",
      values: [provider, userId],
    })
    .then((entries) => {
      return entries.rows.map((entry) => entry.head_cid);
    });
};

const getMetadataByUser = async (provider: string, userId: string) => {
  const db = await getDatabase();

  return db.query<MetadataEntry>({
    text: "SELECT * FROM metadata JOIN object_ownership ON metadata.root_cid = object_ownership.cid WHERE object_ownership.marked_as_deleted IS NULL AND object_ownership.oauth_provider = $1 AND object_ownership.oauth_user_id = $2",
    values: [provider, userId],
  });
};

export const metadataRepository = {
  getMetadata,
  setMetadata,
  getAllMetadata,
  searchMetadataByCID,
  searchMetadataByCIDAndUser,
  searchMetadataByNameAndUser,
  searchMetadataByName,
  getRootObjects,
  getRootObjectsByUser,
  getMetadataByUser,
  getMetadataByRootCid,
  getSharedRootObjectsByUser,
  getMarkedAsDeletedRootObjectsByUser,
};
