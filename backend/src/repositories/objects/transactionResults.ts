import { getDatabase } from '../../drivers/pg.js'
import { TransactionResult } from '../../models/objects/transaction.js'
import { stringify } from '../../utils/misc.js'
import { Node } from './nodes.js'

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
    values: [cid, stringify(transaction_result)],
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
    .query<Node>(
      `
    SELECT n.* FROM nodes n left join transaction_results tr on n.cid = tr.cid where tr.cid is null limit $1
  `,
      [limit],
    )
    .then(({ rows }) => rows)

  return result
}

const getUploadedNodesByRootCid = async (rootCid: string) => {
  const db = await getDatabase()
  const result = await db
    .query<TransactionResultEntry>({
      text: `select tr.* from transaction_results tr join nodes n on tr.cid = n.cid where n.root_cid = $1 and tr.transaction_result->>'blockNumber' is not null order by tr.transaction_result->>'blockNumber' asc
  `,
      values: [rootCid],
    })
    .then(({ rows }) => rows)

  return result
}

const getFirstNotArchivedNode = async () => {
  const db = await getDatabase()

  const result = await db
    .query<{ block_number: number }>({
      text: `SELECT MIN(transaction_results.transaction_result->>'blockNumber') as block_number FROM transaction_results inner join nodes 
      on transaction_results.cid = nodes.cid 
      where nodes.piece_index is null`,
    })
    .then(({ rows }) => rows.at(0)?.block_number ?? null)

  return result
}

export const transactionResultsRepository = {
  storeTransactionResult,
  getTransactionResult,
  getPendingUploads,
  getHeadTransactionResults,
  getUploadedNodesByRootCid,
  getFirstNotArchivedNode,
}
