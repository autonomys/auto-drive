import { MetadataType } from '@autonomys/auto-dag-data'
import { getDatabase } from '../../drivers/pg.js'
import pgFormat from 'pg-format'
import z from 'zod'

export type Node = z.infer<typeof NodeSchema>

export type NodeBlockchainData = Omit<
  Node,
  'encoded_node' | 'root_cid' | 'head_cid' | 'type'
>

export const NodeSchema = z.object({
  cid: z.string(),
  root_cid: z.string(),
  head_cid: z.string(),
  type: z.string(),
  encoded_node: z.string(),
  piece_index: z.number().nullable(),
  piece_offset: z.number().nullable(),
  block_published_on: z.number().nullable(),
  tx_published_on: z.string().nullable(),
})

const saveNode = async (node: Node) => {
  const db = await getDatabase()

  return db.query({
    text: 'INSERT INTO nodes (cid, root_cid, head_cid, type, encoded_node) VALUES ($1, $2, $3, $4, $5);',
    values: [
      node.cid,
      node.root_cid,
      node.head_cid,
      node.type,
      node.encoded_node,
    ],
  })
}

const saveNodes = async (nodes: Node[]) => {
  const db = await getDatabase()

  return db.query({
    text: pgFormat(
      'INSERT INTO nodes (cid, root_cid, head_cid, type, encoded_node, piece_index, piece_offset, block_published_on, tx_published_on) VALUES %L',
      nodes.map((node) => [
        node.cid,
        node.root_cid,
        node.head_cid,
        node.type,
        node.encoded_node,
        node.piece_index,
        node.piece_offset,
        node.block_published_on,
        node.tx_published_on,
      ]),
    ),
  })
}

const getNode = async (cid: string) => {
  const db = await getDatabase()

  return db
    .query<Node>({
      text: 'SELECT * FROM nodes WHERE cid = $1',
      values: [cid],
    })
    .then((e) => (e.rows.length > 0 ? e.rows[0] : undefined))
}

const getNodesByHeadCid = async (headCid: string) => {
  const db = await getDatabase()

  return db
    .query<Omit<Node, 'encoded_node'>>({
      text: 'SELECT cid, root_cid, head_cid, type, piece_index, piece_offset FROM nodes WHERE head_cid = $1',
      values: [headCid],
    })
    .then((e) => e.rows)
}

const getNodesByRootCid = async (rootCid: string) => {
  const db = await getDatabase()

  return db
    .query<Omit<Node, 'encoded_node'>>({
      text: 'SELECT cid, root_cid, head_cid, type, piece_index, piece_offset FROM nodes WHERE root_cid = $1',
      values: [rootCid],
    })
    .then((e) => e.rows)
}

const getNodeCount = async ({
  type,
  cid,
  headCid,
  rootCid,
}: {
  type?: MetadataType
  cid?: string
  headCid?: string
  rootCid?: string
}) => {
  const db = await getDatabase()

  let query =
    'SELECT count(block_published_on) as published_count, count(piece_index) as archived_count, count(*) as total_count FROM nodes'
  const params = []
  const conditions = []

  if (type) {
    conditions.push(`type = $${conditions.length + 1}`)
    params.push(type)
  }

  if (cid) {
    conditions.push(`cid = $${conditions.length + 1}`)
    params.push(cid)
  }

  if (headCid) {
    conditions.push(`head_cid = $${conditions.length + 1}`)
    params.push(headCid)
  }

  if (rootCid) {
    conditions.push(`root_cid = $${conditions.length + 1}`)
    params.push(rootCid)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }

  return db
    .query<{
      published_count: string
      archived_count: string
      total_count: string
    }>({
      text: query,
      values: params,
    })
    .then((e) => ({
      totalCount: Number(e.rows[0].total_count),
      publishedCount: Number(e.rows[0].published_count),
      archivedCount: Number(e.rows[0].archived_count),
    }))
}

const getArchivingNodesCID = async () => {
  const db = await getDatabase()

  return db
    .query<{ cid: string }>({
      text: 'SELECT cid FROM nodes WHERE piece_index IS NULL and piece_offset IS NULL',
    })
    .then((e) => e.rows.map((e) => e.cid))
}

const setNodeArchivingData = async ({
  cid,
  pieceIndex,
  pieceOffset,
}: {
  cid: string
  pieceIndex: number
  pieceOffset: number
}) => {
  const db = await getDatabase()

  return db.query({
    text: 'UPDATE nodes SET piece_index = $1, piece_offset = $2 WHERE cid = $3 AND piece_index IS NULL AND piece_offset IS NULL',
    values: [pieceIndex, pieceOffset, cid],
  })
}

const removeNodeDataByRootCid = async (rootCid: string) => {
  const db = await getDatabase()

  return db.query({
    text: 'UPDATE nodes SET encoded_node = NULL WHERE root_cid = $1',
    values: [rootCid],
  })
}

const removeNodeByRootCid = async (rootCid: string) => {
  const db = await getDatabase()

  return db.query({
    text: 'DELETE FROM nodes WHERE root_cid = $1',
    values: [rootCid],
  })
}
const getNodesByCids = async (cids: string[]): Promise<Node[]> => {
  const db = await getDatabase()

  return db
    .query<Node>({
      text: 'SELECT * FROM nodes WHERE cid = ANY($1)',
      values: [cids],
    })
    .then((e) => e.rows)
}

const updateNodePublishedOn = async (
  cid: string,
  blockPublishedOn: number,
  txPublishedOn: string,
) => {
  const db = await getDatabase()

  return db.query({
    text: 'UPDATE nodes SET block_published_on = $1, tx_published_on = $2 WHERE cid = $3',
    values: [blockPublishedOn, txPublishedOn, cid],
  })
}

const getUploadedNodesByRootCid = async (rootCid: string) => {
  const db = await getDatabase()

  return db
    .query<Node>({
      text: 'SELECT * FROM nodes WHERE root_cid = $1 AND block_published_on IS NOT NULL',
      values: [rootCid],
    })
    .then((e) => e.rows)
}

const getLastArchivedPieceNode = async () => {
  const db = await getDatabase()

  return db
    .query<Node>({
      text: 'SELECT * FROM nodes WHERE piece_index IS NOT NULL AND piece_offset IS NOT NULL ORDER BY piece_index DESC LIMIT 1',
    })
    .then((e) => e.rows.at(0))
}

const getNodesCountWithoutDataByRootCid = async (rootCid: string) => {
  const db = await getDatabase()
  return db.query<{ count: number }>({
    text: 'SELECT COUNT(*) as count FROM nodes WHERE root_cid = $1 AND encoded_node IS NULL',
    values: [rootCid],
  })
}

const getNodeBlockchainData = async (
  cid: string,
): Promise<NodeBlockchainData | undefined> => {
  const db = await getDatabase()

  return db
    .query<NodeBlockchainData>({
      text: 'SELECT cid, block_published_on, tx_published_on, piece_index, piece_offset FROM nodes WHERE cid = $1 AND block_published_on IS NOT NULL',
      values: [cid],
    })
    .then((e) => e.rows.at(0))
}

const getNodesBlockchainDataBatch = async (
  cids: string[],
): Promise<NodeBlockchainData[]> => {
  if (cids.length === 0) return []

  const db = await getDatabase()

  return db
    .query<NodeBlockchainData>({
      text: 'SELECT DISTINCT ON (cid) cid, block_published_on, tx_published_on, piece_index, piece_offset FROM nodes WHERE cid = ANY($1) AND block_published_on IS NOT NULL ORDER BY cid, block_published_on DESC',
      values: [cids],
    })
    .then((e) => e.rows)
}

const updateNodeBlockchainData = async (
  rootCid: string,
  cid: string,
  blockchainData: NodeBlockchainData,
) => {
  const db = await getDatabase()
  return db.query({
    text: 'UPDATE nodes SET block_published_on = $1, tx_published_on = $2, piece_index = $3, piece_offset = $4 WHERE root_cid = $5 AND cid = $6',
    values: [
      blockchainData.block_published_on,
      blockchainData.tx_published_on,
      blockchainData.piece_index,
      blockchainData.piece_offset,
      rootCid,
      cid,
    ],
  })
}

const updateNodesBlockchainDataBatch = async (
  updates: Array<{
    rootCid: string
    cid: string
    blockchainData: NodeBlockchainData
  }>,
) => {
  if (updates.length === 0) return

  const db = await getDatabase()

  // Use a single query with VALUES to batch update
  // Group by (rootCid, cid) to avoid duplicates
  const uniqueUpdates = Array.from(
    new Map(updates.map((u) => [`${u.rootCid}:${u.cid}`, u])).values(),
  )

  const payload = uniqueUpdates.map((u) => ({
    block_published_on: u.blockchainData.block_published_on,
    tx_published_on: u.blockchainData.tx_published_on,
    piece_index: u.blockchainData.piece_index,
    piece_offset: u.blockchainData.piece_offset,
    root_cid: u.rootCid,
    cid: u.cid,
  }))

  return db.query({
    text: `
      UPDATE nodes AS n
      SET
        block_published_on = data.block_published_on,
        tx_published_on = data.tx_published_on,
        piece_index = data.piece_index,
        piece_offset = data.piece_offset
      FROM jsonb_to_recordset($1::jsonb) AS data(
        block_published_on INTEGER,
        tx_published_on TEXT,
        piece_index INTEGER,
        piece_offset INTEGER,
        root_cid TEXT,
        cid TEXT
      )
      WHERE n.root_cid = data.root_cid AND n.cid = data.cid
    `,
    values: [JSON.stringify(payload)],
  })
}

const hasEncodedNode = async (cid: string) => {
  const db = await getDatabase()
  return db
    .query<{ exists: boolean }>({
      text: 'SELECT EXISTS(SELECT 1 FROM nodes WHERE cid = $1 AND encoded_node IS NOT NULL)',
      values: [cid],
    })
    .then((e) => e.rows[0].exists)
}

export const nodesRepository = {
  getNode,
  getNodeCount,
  saveNode,
  saveNodes,
  getArchivingNodesCID,
  setNodeArchivingData,
  getNodesByHeadCid,
  getNodesByRootCid,
  removeNodeDataByRootCid,
  getNodesByCids,
  updateNodePublishedOn,
  getUploadedNodesByRootCid,
  getLastArchivedPieceNode,
  removeNodeByRootCid,
  getNodesCountWithoutDataByRootCid,
  getNodeBlockchainData,
  getNodesBlockchainDataBatch,
  updateNodeBlockchainData,
  updateNodesBlockchainDataBatch,
  hasEncodedNode,
}
