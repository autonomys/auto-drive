import { MetadataType } from '@autonomys/auto-dag-data'
import { getDatabase } from '../../drivers/pg.js'

interface BlockstoreEntry {
  upload_id: string
  cid: string
  node_type: MetadataType
  node_size: bigint
  data: Buffer
}

const parseEntry = (entry: BlockstoreEntry) => {
  return {
    ...entry,
    node_size: entry.node_size.toString(),
  }
}

const addBlockstoreEntry = async (
  uploadId: string,
  cid: string,
  nodeType: MetadataType,
  nodeSize: bigint,
  data: Buffer,
) => {
  const db = await getDatabase()

  // ON CONFLICT DO NOTHING makes writing a root node idempotent, which
  // blockstore_root_node_unique_idx alone would not: with only the constraint, a
  // completion that died after writing the root node but before flipping the
  // upload to MIGRATING could never be retried — every retry would raise a
  // unique violation and the upload would be stuck for good. Re-writing the same
  // (upload_id, cid) is a no-op instead, so a retry proceeds and derives the same
  // CID.
  //
  // The bare form (no conflict target) takes no action on a violation of *any*
  // arbiter index, so it is scoped by the partial index: chunk rows are not
  // covered by it and still insert unconditionally, which they must — a file with
  // two identical chunks legitimately stores two rows with the same CID.
  await db.query(
    'INSERT INTO uploads.blockstore (upload_id, cid, node_type, node_size, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    [uploadId, cid, nodeType, nodeSize, data],
  )
}

const addBatchBlockstoreEntries = async (entries: BlockstoreEntry[]) => {
  const db = await getDatabase()

  await db.query(
    `INSERT INTO uploads.blockstore (upload_id, cid, node_type, node_size, data) VALUES ${entries
      .map(
        (entry) =>
          `(${entry.upload_id}, ${entry.cid}, ${entry.node_type}, ${entry.node_size}, ${entry.data})`,
      )
      .join(',')}`,
  )
}

const getBlockstoreEntries = async (uploadId: string) => {
  const db = await getDatabase()

  const result = await db.query<BlockstoreEntry>(
    'SELECT * FROM uploads.blockstore WHERE upload_id = $1 ORDER BY sort_id ASC',
    [uploadId],
  )

  return result.rows.map(parseEntry)
}

const getBatchBlockstoreEntries = async (uploadIds: string, cids: string[]) => {
  const db = await getDatabase()

  const result = await db.query<BlockstoreEntry>(
    'SELECT * FROM uploads.blockstore WHERE upload_id = $1 AND cid = ANY($2) ORDER BY sort_id ASC',
    [uploadIds, cids],
  )

  return result.rows.map(parseEntry)
}

const getBlockstoreEntriesWithoutData = async (uploadId: string) => {
  const db = await getDatabase()

  const result = await db.query<BlockstoreEntry>(
    'SELECT upload_id, cid, node_type, node_size FROM uploads.blockstore WHERE upload_id = $1 ORDER BY sort_id ASC',
    [uploadId],
  )

  return result.rows.map(parseEntry)
}

const getByType = async (uploadId: string, nodeType: MetadataType) => {
  const db = await getDatabase()

  const result = await db.query<BlockstoreEntry>(
    'SELECT * FROM uploads.blockstore WHERE upload_id = $1 AND node_type = $2 ORDER BY sort_id ASC',
    [uploadId, nodeType],
  )

  return result.rows.map(parseEntry)
}

const getByCid = async (uploadId: string, cid: string) => {
  const db = await getDatabase()

  const result = await db.query<BlockstoreEntry>(
    'SELECT * FROM uploads.blockstore WHERE upload_id = $1 AND cid = $2 ORDER BY sort_id ASC',
    [uploadId, cid],
  )

  return result.rows.map(parseEntry).at(0) ?? null
}

const getByCIDWithoutData = async (uploadId: string, cid: string) => {
  const db = await getDatabase()

  const result = await db.query<BlockstoreEntry>(
    'SELECT upload_id, cid, node_type, node_size FROM uploads.blockstore WHERE upload_id = $1 AND cid = $2 ORDER BY sort_id ASC',
    [uploadId, cid],
  )

  return result.rows.map(parseEntry).at(0) ?? null
}

const getByCIDAndRootUploadId = async (rootUploadId: string, cid: string) => {
  const db = await getDatabase()

  const result = await db.query<BlockstoreEntry>(
    'SELECT uploads.blockstore.* FROM uploads.uploads inner join uploads.blockstore on uploads.uploads.id = uploads.blockstore.upload_id WHERE uploads.uploads.root_upload_id = $1 AND uploads.blockstore.cid = $2',
    [rootUploadId, cid],
  )

  return result.rows.map(parseEntry).at(0) ?? null
}

const deleteBlockstoreEntry = async (uploadId: string, cid: string) => {
  const db = await getDatabase()

  await db.query(
    'DELETE FROM uploads.blockstore WHERE upload_id = $1 AND cid = $2',
    [uploadId, cid],
  )
}

const deleteBlockstoreEntries = async (uploadId: string) => {
  const db = await getDatabase()

  await db.query('DELETE FROM uploads.blockstore WHERE upload_id = $1', [
    uploadId,
  ])
}

const getNodesByCid = async (cid: string) => {
  const db = await getDatabase()

  const result = await db.query<BlockstoreEntry>(
    'SELECT * FROM uploads.blockstore WHERE cid = $1 ORDER BY sort_id ASC',
    [cid],
  )

  return result.rows.map(parseEntry)
}

export const blockstoreRepository = {
  addBlockstoreEntry,
  addBatchBlockstoreEntries,
  getBlockstoreEntries,
  getBatchBlockstoreEntries,
  getBlockstoreEntriesWithoutData,
  getByType,
  getByCid,
  deleteBlockstoreEntry,
  getByCIDWithoutData,
  getByCIDAndRootUploadId,
  getNodesByCid,
  deleteBlockstoreEntries,
}
