import { getDatabase } from '../../drivers/pg.js'
import { TransactionResult } from '../../models/objects/transaction.js'
import { BlockstoreEntry } from '../uploads/blockstore.js'

export interface TransactionResultEntry {
  cid: string
  transaction_result: TransactionResult
}

const storeTransactionResult = async (
  cid: string,
  transaction_result: TransactionResult,
) => {
  const db = await getDatabase()

  await db.query({
    text: 'INSERT INTO transaction_results (cid, transaction_result) VALUES ($1, $2) ON CONFLICT (cid) DO UPDATE SET transaction_result = EXCLUDED.transaction_result',
    values: [cid, JSON.stringify(transaction_result)],
  })
}

const getTransactionResult = async (cid: string) => {
  const db = await getDatabase()

  const result = await db
    .query<TransactionResultEntry>({
      text: 'SELECT * FROM transaction_results WHERE cid = $1',
      values: [cid],
    })
    .then(({ rows }) => {
      return rows.length > 0 ? rows[0] : undefined
    })

  return result
}

const getHeadTransactionResults = async (head_cid: string) => {
  const db = await getDatabase()
  const result = await db
    .query<TransactionResultEntry>({
      text: 'SELECT * FROM transaction_results WHERE head_cid = $1',
      values: [head_cid],
    })
    .then(({ rows }) => rows)

  return result
}

const getPendingUploads = async (limit: number = 100) => {
  const db = await getDatabase()
  const result = await db
    .query<BlockstoreEntry>(
      `
    SELECT n.* FROM uploads.blockstore n left join transaction_results tr on n.cid = tr.cid where tr.cid is null limit $1
  `,
      [limit],
    )
    .then(({ rows }) => rows)

  return result
}

const getPendingUploadsByHeadCid = async (headCid: string) => {
  const db = await getDatabase()
  const result = await db
    .query<Node>({
      text: `
    select tr.* from transaction_results tr join nodes n on tr.cid = n.cid where n.head_cid = $1 and tr.transaction_result->>'blockNumber' is not null order by tr.transaction_result->>'blockNumber' asc
  `,
      values: [headCid],
    })
    .then(({ rows }) => rows)

  return result
}

const getUploadedNodesByRootCid = async (rootCid: string) => {
  const db = await getDatabase()
  const result = await db
    .query<TransactionResultEntry>({
      text: `select * from uploads.uploads u join uploads.blockstore b on u.id = b.upload_id and u.root_upload_id = u.id where b.cid = $1
  `,
      values: [rootCid],
    })
    .then(({ rows }) => rows)

  return result
}

export const transactionResultsRepository = {
  storeTransactionResult,
  getTransactionResult,
  getPendingUploads,
  getHeadTransactionResults,
  getPendingUploadsByHeadCid,
  getUploadedNodesByRootCid,
}
