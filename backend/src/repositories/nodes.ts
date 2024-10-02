import { MetadataType } from "@autonomys/auto-drive";
import { getDatabase } from "../drivers/pg.js";

export interface Node {
  cid: string;
  head_cid: string;
  type: MetadataType;
  encoded_node: string;
}

const saveNode = async (node: Node) => {
  const db = await getDatabase();

  return db.query({
    text: "INSERT INTO nodes (cid, head_cid, type, encoded_node) VALUES ($1, $2, $3, $4) ON CONFLICT (cid) DO UPDATE SET head_cid = EXCLUDED.head_cid, type = EXCLUDED.type, encoded_node = EXCLUDED.encoded_node",
    values: [node.cid, node.head_cid, node.type, node.encoded_node],
  });
};

const getNode = async (cid: string) => {
  const db = await getDatabase();

  return db
    .query<Node>({ text: "SELECT * FROM nodes WHERE cid = $1", values: [cid] })
    .then((e) => (e.rows.length > 0 ? e.rows[0] : undefined));
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
    conditions.push(`type = $${conditions.length + 1}`);
    params.push(type);
  }

  if (cid) {
    conditions.push(`cid = $${conditions.length + 1}`);
    params.push(cid);
  }

  if (headCid) {
    conditions.push(`head_cid = $${conditions.length + 1}`);
    params.push(headCid);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  return db.query<Node>({ text: query, values: params }).then((e) => e.rows);
};

export const nodesRepository = {
  getNode,
  getNodes,
  saveNode,
};
