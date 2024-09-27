import { MetadataType } from "@autonomys/auto-drive";
import { getDatabase } from "../drivers/sqlite.js";

export interface Node {
  cid: string;
  head_cid: string;
  type: MetadataType;
  encoded_node: string;
}

const saveNode = async (node: Node) => {
  const db = await getDatabase();

  return db.run(
    "INSERT OR REPLACE INTO nodes (cid, head_cid, type, encoded_node) VALUES (?, ?, ?, ?)",
    [node.cid, node.head_cid, node.type, node.encoded_node]
  );
};

const getNode = async (cid: string) => {
  const db = await getDatabase();

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
  const db = await getDatabase();

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
  getNode,
  getNodes,
  saveNode,
};
