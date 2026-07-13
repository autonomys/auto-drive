import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { getDatabase } from '../../drivers/pg.js'
import { PaginatedResult } from '@auto-drive/models'
import { stringify } from '../../../shared/utils/misc.js'
import { ownershipSQL } from './ownership.js'

export interface MetadataEntry {
  root_cid: string
  head_cid: string
  name: string
  metadata: OffchainMetadata
  is_archived: boolean
  created_at: Date
  tags: string[] | null
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
      // Hide objects an owner has removed (moved to Trash). Removal is tracked
      // on the root upload's ownership row, so we must resolve each match to its
      // root before checking admin ownership — otherwise children of a removed
      // folder (which keep vestigial active admin rows) would still surface.
      // Mirrors ObjectUseCases.isObjectDeleted.
      text: `SELECT DISTINCT metadata.* FROM metadata
        WHERE metadata.head_cid LIKE $1
        AND ${ownershipSQL.notRemovedByOwnerSQL('metadata.head_cid')}
        LIMIT $2`,
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
      // See searchMetadataByCID: resolve each match to its root before applying
      // the removal filter so children of a removed folder stay hidden.
      text: `SELECT DISTINCT m.* FROM metadata m
        WHERE m.metadata->>'name' ILIKE $1
        AND ${ownershipSQL.notRemovedByOwnerSQL('m.head_cid')}
        LIMIT $2`,
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
      WHERE oo.is_admin IS TRUE
      AND oo.marked_as_deleted IS NULL
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
          -- Hide shares whose owner has removed the object globally. The
          -- recipient's own (non-admin) row stays active, so we must also
          -- require a still-active admin owner, mirroring the GetSharedFiles
          -- GraphQL filter and ObjectUseCases.isObjectDeleted.
          AND EXISTS (
            SELECT 1 FROM object_ownership admin_oo
            WHERE admin_oo.cid = m.root_cid
              AND admin_oo.is_admin IS TRUE
              AND admin_oo.marked_as_deleted IS NULL
          )
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
  limit: number,
  offset: number,
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

const markAsArchived = async (cid: string) => {
  const db = await getDatabase()

  await db.query({
    text: 'UPDATE metadata SET is_archived = true WHERE head_cid = $1',
    values: [cid],
  })
}

const getMetadataByIsArchived = async (isArchived: boolean) => {
  const db = await getDatabase()

  const result = await db.query<MetadataEntry>({
    text: 'SELECT * FROM metadata WHERE is_archived = $1',
    values: [isArchived],
  })

  return result.rows
}

const addTag = async (cid: string, tag: string) => {
  const db = await getDatabase()

  await db.query({
    text: 'UPDATE metadata SET tags = array_append(tags, $1) WHERE head_cid = $2',
    values: [tag, cid],
  })
}

const removeTag = async (cid: string, tag: string) => {
  const db = await getDatabase()

  await db.query({
    text: 'UPDATE metadata SET tags = array_remove(tags, $1) WHERE head_cid = $2',
    values: [tag, cid],
  })
}

const getMetadataByTagIncludeExclude = async (
  tagIncludes: string[],
  tagToExclude: string[],
  limit: number,
  offset: number,
) => {
  const db = await getDatabase()
  return db.query<MetadataEntryWithTotalCount>({
    text: `
      SELECT * FROM metadata WHERE tags @> $1 AND NOT tags @> $2
      LIMIT $3 OFFSET $4
    `,
    values: [tagIncludes, tagToExclude, limit, offset],
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
  markAsArchived,
  getMetadataByIsArchived,
  addTag,
  removeTag,
  getMetadataByTagIncludeExclude,
}
