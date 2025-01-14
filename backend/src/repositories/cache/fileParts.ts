import { getDatabase } from '../../drivers/pg.js'

export interface CacheFilePart {
  cid: string
  index: number
  data: Buffer
}

const addFilePart = async (filePart: CacheFilePart) => {
  const db = await getDatabase()
  await db.query({
    text: 'INSERT INTO download_cache.file_parts (cid, index, data) VALUES ($1, $2, $3)',
    values: [filePart.cid, filePart.index, filePart.data],
  })
}

const getFilePartCount = async (cid: string) => {
  const db = await getDatabase()
  const result = await db.query<{ count: number }>({
    text: 'SELECT COUNT(*) as count FROM download_cache.file_parts WHERE cid = $1',
    values: [cid],
  })

  return result.rows[0].count
}

const getFilePart = async (cid: string, index: number) => {
  const db = await getDatabase()
  const result = await db.query<CacheFilePart>({
    text: 'SELECT * FROM download_cache.file_parts WHERE cid = $1 AND index = $2',
    values: [cid, index],
  })

  return result.rows[0]
}

const removeFileParts = async (cids: string[]) => {
  const db = await getDatabase()
  await db.query({
    text: 'DELETE FROM download_cache.file_parts WHERE cid = ANY($1)',
    values: [cids],
  })
}

export const clear = async () => {
  const db = await getDatabase()
  await db.query({
    text: 'DELETE FROM download_cache.file_parts',
  })
}

export const downloadCacheFilePartsRepository = {
  addFilePart,
  getFilePartCount,
  getFilePart,
  removeFileParts,
  clear,
}
