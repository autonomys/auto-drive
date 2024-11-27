import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { getDatabase } from '../../drivers/pg.js'
import { PaginatedResult } from '../../useCases/objects/common.js'
import { stringify } from '../../utils/misc.js'

export interface MetadataEntry {
  root_cid: string
  head_cid: string
  name: string
  metadata: OffchainMetadata
}

type MetadataEntryWithTotalCount = MetadataEntry & {
  total_count: number
}

const getMetadata = async (cid: string): Promise<MetadataEntry | undefined> => {
  const db = await getDatabase()

  return db
    .query<MetadataEntry>({
      text: 'SELECT * FROM metadata WHERE head_cid = $1',
      values: [cid],
    })
    .then((entry) => {
      return entry.rows.length > 0 ? entry.rows[0] : undefined
    })
}

const setMetadata = async (
  rootCid: string,
  headCid: string,
  metadata: OffchainMetadata,
) => {
  const db = await getDatabase()

  return db.query({
    text: 'INSERT INTO metadata (root_cid, head_cid, metadata, name) VALUES ($1, $2, $3, $4) ON CONFLICT (root_cid, head_cid) DO UPDATE SET metadata = EXCLUDED.metadata, name = EXCLUDED.name',
    values: [rootCid, headCid, stringify(metadata), metadata.name],
  })
}

const searchMetadataByCID = async (
  cid: string,
  limit: number | undefined,
): Promise<MetadataEntry[]> => {
  const db = await getDatabase()

  return db
    .query<MetadataEntry>({
      text: 'SELECT metadata.* FROM metadata join object_ownership on metadata.head_cid = object_ownership.cid WHERE metadata.head_cid LIKE $1 LIMIT $2',
      values: [`%${cid}%`, limit],
    })
    .then((entries) => entries.rows)
}

const searchMetadataByCIDAndUser = async (
  cid: string,
  limit: number | undefined,
  provider: string,
  userId: string,
): Promise<MetadataEntry[]> => {
  const db = await getDatabase()

  return db
    .query<MetadataEntry>({
      text: `
    SELECT m.* FROM metadata m
    JOIN object_ownership oo ON m.head_cid = oo.cid
    WHERE oo.oauth_provider = $1
    AND oo.oauth_user_id = $2
    AND oo.marked_as_deleted IS NULL
    AND oo.is_admin IS TRUE
    AND m.head_cid LIKE $3
    LIMIT $4
    `,
      values: [provider, userId, `%${cid}%`, limit],
    })
    .then((entries) => entries.rows)
}

const searchMetadataByNameAndUser = async (
  query: string,
  provider: string,
  userId: string,
  limit: number,
): Promise<MetadataEntry[]> => {
  const db = await getDatabase()

  return db
    .query<MetadataEntry>({
      text: `
      SELECT m.* FROM metadata m
    JOIN object_ownership oo ON m.head_cid = oo.cid
    WHERE oo.oauth_provider = $1
    AND oo.oauth_user_id = $2
    AND oo.marked_as_deleted IS NULL
    AND oo.is_admin IS TRUE
    AND m.metadata->>'name' ILIKE $3
    LIMIT $4`,
      values: [provider, userId, `%${query}%`, limit],
    })
    .then((entries) => entries.rows)
}

const searchMetadataByName = async (query: string, limit: number) => {
  const db = await getDatabase()

  return db
    .query<MetadataEntry>({
      // eslint-disable-next-line quotes
      text: `SELECT * FROM metadata WHERE metadata->>'name' ILIKE $1 LIMIT $2`,
      values: [`%${query}%`, limit],
    })
    .then((entries) => entries.rows)
}

const getAllMetadata = async () => {
  const db = await getDatabase()

  return db
    .query<MetadataEntry>('SELECT * FROM metadata')
    .then((entries) => entries.rows)
}

const getMetadataByRootCid = async (rootCid: string) => {
  const db = await getDatabase()

  return db
    .query<MetadataEntry>('SELECT * FROM metadata WHERE root_cid = $1', [
      rootCid,
    ])
    .then((entries) => entries.rows)
}

const getRootObjects = async (
  limit: number = 100,
  offset: number = 0,
): Promise<PaginatedResult<MetadataEntry['head_cid']>> => {
  const db = await getDatabase()

  return db
    .query<MetadataEntryWithTotalCount>({
      text: `with root_objects as (
        SELECT m.* 
        FROM metadata m 
        WHERE m.root_cid = m.head_cid
      )
      SELECT root_objects.head_cid, COUNT(*) OVER() AS total_count
      FROM root_objects
      INNER JOIN object_ownership oo ON root_objects.head_cid = oo.cid 
      WHERE oo.marked_as_deleted IS NULL 
      GROUP BY root_objects.head_cid
      LIMIT $1 OFFSET $2`,
      values: [limit, offset],
    })
    .then((entries) => ({
      rows: entries.rows.map((entry) => entry.head_cid),
      totalCount: entries.rows.at(0)?.total_count ?? 0,
    }))
}

const getRootObjectsByUser = async (
  provider: string,
  userId: string,
  limit: number = 100,
  offset: number = 0,
): Promise<PaginatedResult<MetadataEntry['head_cid']>> => {
  const db = await getDatabase()

  return db
    .query<MetadataEntryWithTotalCount>({
      text: `
        SELECT m.*, COUNT(*) OVER() AS total_count 
        FROM metadata m 
        JOIN object_ownership oo ON m.root_cid = oo.cid 
        WHERE m.root_cid = m.head_cid 
          AND oo.oauth_provider = $1 
          AND oo.oauth_user_id = $2 
          AND oo.is_admin IS TRUE 
          AND oo.marked_as_deleted IS NULL 
        LIMIT $3 OFFSET $4`,
      values: [provider, userId, limit, offset],
    })
    .then((entries) => {
      return {
        rows: entries.rows.map((entry) => entry.root_cid),
        totalCount: entries.rows.at(0)?.total_count ?? 0,
      }
    })
}

const getSharedRootObjectsByUser = async (
  provider: string,
  userId: string,
  limit: number = 100,
  offset: number = 0,
): Promise<PaginatedResult<MetadataEntry['head_cid']>> => {
  const db = await getDatabase()

  return db
    .query<MetadataEntryWithTotalCount>({
      text: `
        SELECT m.*, COUNT(*) OVER() AS total_count 
        FROM metadata m 
        JOIN object_ownership oo ON m.root_cid = oo.cid 
        WHERE m.root_cid = m.head_cid 
          AND oo.oauth_provider = $1 
          AND oo.oauth_user_id = $2 
          AND oo.is_admin IS FALSE 
          AND oo.marked_as_deleted IS NULL 
        LIMIT $3 OFFSET $4`,
      values: [provider, userId, limit, offset],
    })
    .then((entries) => {
      return {
        rows: entries.rows.map((entry) => entry.head_cid),
        totalCount: entries.rows.at(0)?.total_count ?? 0,
      }
    })
}

const getMarkedAsDeletedRootObjectsByUser = async (
  provider: string,
  userId: string,
  limit: number = 100,
  offset: number = 0,
): Promise<PaginatedResult<MetadataEntry['head_cid']>> => {
  const db = await getDatabase()

  return db
    .query<MetadataEntryWithTotalCount>({
      text: `
        SELECT m.*, COUNT(*) OVER() AS total_count 
        FROM metadata m 
        JOIN object_ownership oo ON m.root_cid = oo.cid 
        WHERE m.root_cid = m.head_cid 
          AND oo.oauth_provider = $1 
          AND oo.oauth_user_id = $2 
          AND oo.marked_as_deleted IS NOT NULL 
        LIMIT $3 OFFSET $4`,
      values: [provider, userId, limit, offset],
    })
    .then((entries) => {
      return {
        rows: entries.rows.map((entry) => entry.head_cid),
        totalCount: entries.rows.at(0)?.total_count ?? 0,
      }
    })
}

const getMetadataByUser = async (provider: string, userId: string) => {
  const db = await getDatabase()

  return db.query<MetadataEntry>({
    text: 'SELECT * FROM metadata JOIN object_ownership ON metadata.root_cid = object_ownership.cid WHERE object_ownership.marked_as_deleted IS NULL AND object_ownership.oauth_provider = $1 AND object_ownership.oauth_user_id = $2',
    values: [provider, userId],
  })
}

export const metadataRepository = {
  getMetadata,
  setMetadata,
  getAllMetadata,
  searchMetadataByCID,
  searchMetadataByCIDAndUser,
  searchMetadataByNameAndUser,
  searchMetadataByName,
  getRootObjects,
  getRootObjectsByUser,
  getMetadataByUser,
  getMetadataByRootCid,
  getSharedRootObjectsByUser,
  getMarkedAsDeletedRootObjectsByUser,
}
