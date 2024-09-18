import { MetadataType } from "@autonomys/auto-drive";
import { getDatabase } from "./sqlite.js";

export interface Node {
  cid: string;
  head_cid: string;
  type: MetadataType;
  encoded_node: string;
}

const initTable = async () => {
  const db = await getDatabase();

  db.exec(
    "CREATE TABLE IF NOT EXISTS nodes (cid TEXT PRIMARY KEY, head_cid TEXT, type TEXT, encoded_node TEXT)"
  );
  db.exec("CREATE INDEX IF NOT EXISTS nodes_head_cid ON nodes (head_cid)");

  return db;
};

const saveNode = async (node: Node) => {
  const db = await initTable();

  return db.run(
    "INSERT OR REPLACE INTO nodes (cid, head_cid, type, encoded_node) VALUES (?, ?, ?, ?)",
    [node.cid, node.head_cid, node.type, node.encoded_node]
  );
};

const getNode = async (cid: string) => {
  const db = await initTable();

  return db.get<Node>("SELECT * FROM nodes WHERE cid = ?", [cid]);
};

// TODO: Add pagination
const getNodes = async ({
  type,
  cid,
  headCid,
}: {
  type?: MetadataType;
  cid?: string;
  headCid?: string;
}) => {
  const db = await initTable();

  let query = "SELECT * FROM nodes";
  const params = [];
  const conditions = [];

  if (type) {
    conditions.push("type = ?");
    params.push(type);
  }

  if (cid) {
    conditions.push("cid = ?");
    params.push(cid);
  }

  if (headCid) {
    conditions.push("head_cid = ?");
    params.push(headCid);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  return db.get<Node>(query, params);
};

export const nodesRepository = {
  initTable,
  getNode,
  getNodes,
  saveNode,
};
