import pg from 'pg'
import { MultiUploadBlockstore } from './blockstore.js'

// With a client, every read and write runs inside that client's transaction.
export const getUploadBlockstore = async (
  uploadId: string,
  client?: pg.PoolClient,
) => {
  return new MultiUploadBlockstore(uploadId, client)
}
