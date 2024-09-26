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
    .all<{ cid: string }[]>(
      "SELECT cid FROM metadata WHERE cid LIKE ? LIMIT ?",
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

/// TODO: pagination and filtering
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

export const metadataRepository = {
  getMetadata,
  setMetadata,
  getAllMetadata,
  searchMetadataByCID,
};
