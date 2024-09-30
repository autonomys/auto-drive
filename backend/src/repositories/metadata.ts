import { OffchainMetadata } from "@autonomys/auto-drive";
import { getDatabase } from "../drivers/sqlite.js";

export interface MetadataEntry<T extends string | OffchainMetadata = string> {
  cid: string;
  metadata: T;
}

const getMetadata = async (
  cid: string
): Promise<MetadataEntry<OffchainMetadata> | undefined> => {
  const db = await getDatabase();

  return db
    .get<MetadataEntry>("SELECT * FROM metadata WHERE cid = ?", cid)
    .then((entry) => {
      return entry
        ? { cid: entry.cid, metadata: JSON.parse(entry.metadata) }
        : undefined;
    });
};

const setMetadata = async (cid: string, metadata: OffchainMetadata) => {
  const db = await getDatabase();

  return db.run(
    "INSERT OR REPLACE INTO metadata (cid, metadata) VALUES (?, ?)",
    cid,
    JSON.stringify(metadata)
  );
};

const searchMetadataByCID = async (cid: string, limit: number | undefined) => {
  const db = await getDatabase();

  return db
    .all<MetadataEntry[]>(
      "SELECT metadata.cid FROM metadata join object_ownership on metadata.cid = object_ownership.cid WHERE marked_as_deleted = 0 AND metadata.cid LIKE ? LIMIT ?",
      `%${cid}%`,
      limit
    )
    .then((entries) => {
      return entries.map((entry) => {
        return {
          cid: entry.cid,
        };
      });
    });
};

const searchMetadataByCIDAndUser = async (
  cid: string,
  limit: number | undefined,
  userId: string
): Promise<string[]> => {
  const db = await getDatabase();

  return db
    .all<MetadataEntry[]>(
      `
    SELECT m.* FROM metadata m
    JOIN object_ownership oo ON m.cid = oo.cid
    WHERE oo.user_id = ?
    AND oo.marked_as_deleted = 0
    AND m.cid LIKE ?
    LIMIT ?
  `,
      userId,
      `%${cid}%`,
      limit
    )
    .then((entries) => entries.map((entry) => entry.cid));
};

export const getAllMetadata = async () => {
  const db = await getDatabase();

  return db.all<MetadataEntry[]>("SELECT * FROM metadata").then((entries) => {
    return entries.map((entry) => {
      return {
        cid: entry.cid,
        metadata: JSON.parse(entry.metadata),
      } as MetadataEntry<OffchainMetadata>;
    });
  });
};

const getRootObjects = async () => {
  const db = await getDatabase();

  return db
    .all<MetadataEntry[]>(
      "SELECT m.* FROM metadata m join transactionResults tr on m.cid = tr.cid WHERE tr.head_cid = tr.cid"
    )
    .then((entries) => {
      return entries.map((entry) => entry.cid);
    });
};

const getRootObjectsByUser = async (userId: string) => {
  const db = await getDatabase();

  return db
    .all<MetadataEntry[]>(
      "SELECT m.* FROM metadata m, transactionResults tr, object_ownership oo where m.cid = tr.cid and oo.cid = tr.cid and tr.head_cid = tr.cid and oo.user_id = ?",
      userId
    )
    .then((entries) => {
      return entries.map((entry) => entry.cid);
    });
};

const getMetadataByUser = async (userId: string) => {
  const db = await getDatabase();

  return db.all<MetadataEntry[]>(
    "SELECT * FROM metadata JOIN object_ownership ON metadata.cid = object_ownership.cid WHERE object_ownership.marked_as_deleted = 0 AND object_ownership.user_id = ?",
    userId
  );
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
