import { getDatabase } from '../../drivers/pg.js'

interface RegistryEntry {
  cid: string
  last_accessed_at: Date
  size: string
}

const toBigInt = (value: RegistryEntry) => ({
  ...value,
  size: BigInt(value.size).valueOf(),
})

const addEntry = async (entry: RegistryEntry) => {
  const db = await getDatabase()
  await db
    .query({
      text: 'INSERT INTO download_cache.registry (cid, last_accessed_at, size) VALUES ($1, $2, $3)',
      values: [entry.cid, entry.last_accessed_at, entry.size],
    })
    .then((e) => e.rows.map(toBigInt))
}

const removeEntries = async (cids: string[]) => {
  const db = await getDatabase()
  await db.query({
    text: 'DELETE FROM download_cache.registry WHERE cid = ANY($1)',
    values: [cids],
  })
}

const getEntriesSortedByLastAccessedAt = async () => {
  const db = await getDatabase()
  const result = await db.query<RegistryEntry>({
    text: 'SELECT * FROM download_cache.registry ORDER BY last_accessed_at ASC',
  })

  return result.rows.map(toBigInt)
}

const getTotalSize = async () => {
  const db = await getDatabase()
  return db
    .query<{ size: string }>({
      text: 'SELECT SUM(size) as size FROM download_cache.registry',
    })
    .then((result) => BigInt(result.rows[0].size).valueOf())
}

const getEntry = async (cid: string) => {
  const db = await getDatabase()
  const result = await db.query<RegistryEntry>({
    text: 'SELECT * FROM download_cache.registry WHERE cid = $1',
    values: [cid],
  })

  return result.rows.map(toBigInt)[0]
}

export const registryRepository = {
  addEntry,
  removeEntries,
  getEntriesSortedByLastAccessedAt,
  getTotalSize,
  getEntry,
}
