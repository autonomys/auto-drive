import { FileUploadOptions } from '@autonomys/auto-dag-data'
import { getDatabase } from '../../drivers/pg.js'
import { FolderTreeFolder, UploadStatus, UploadType } from '@auto-drive/models'

export type UploadEntry = {
  id: string
  type: UploadType
  status: UploadStatus
  name: string
  file_tree: FolderTreeFolder | null
  mime_type: string | null
  root_upload_id: string
  relative_id: string | null
  oauth_provider: string
  oauth_user_id: string
  upload_options: FileUploadOptions | null
}

export const createUploadEntry = async (
  id: string,
  type: UploadType,
  status: UploadStatus,
  name: string,
  file_tree: FolderTreeFolder | null,
  mime_type: string | null,
  root_upload_id: string | null,
  relative_id: string | null,
  oauth_provider: string,
  oauth_user_id: string,
  upload_options: FileUploadOptions | null,
): Promise<UploadEntry> => {
  const db = await getDatabase()

  const result = await db.query(
    'INSERT INTO uploads.uploads (id, type, status, name, file_tree, mime_type, root_upload_id, relative_id, oauth_provider, oauth_user_id, upload_options) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
    [
      id,
      type,
      status,
      name,
      file_tree,
      mime_type,
      root_upload_id,
      relative_id,
      oauth_provider,
      oauth_user_id,
      upload_options,
    ],
  )

  return result.rows[0]
}

export const getUploadEntryById = async (
  id: string,
): Promise<UploadEntry | null> => {
  const db = await getDatabase()

  const result = await db.query('SELECT * FROM uploads.uploads WHERE id = $1', [
    id,
  ])

  return result.rows.at(0) ?? null
}

export const updateUploadEntry = async (
  upload: UploadEntry,
): Promise<UploadEntry> => {
  const db = await getDatabase()

  const result = await db.query(
    'UPDATE uploads.uploads SET status = $2, file_tree = $3, mime_type = $4, root_upload_id = $5, relative_id = $6, upload_options = $7 WHERE id = $1 RETURNING *',
    [
      upload.id,
      upload.status,
      upload.file_tree,
      upload.mime_type,
      upload.root_upload_id,
      upload.relative_id,
      upload.upload_options,
    ],
  )

  return result.rows[0]
}

export const updateUploadStatusByRootUploadId = async (
  root_upload_id: string,
  status: UploadStatus,
): Promise<void> => {
  const db = await getDatabase()

  await db.query(
    'UPDATE uploads.uploads SET status = $2 WHERE root_upload_id = $1',
    [root_upload_id, status],
  )
}

export const deleteUploadEntry = async (id: string): Promise<void> => {
  const db = await getDatabase()

  await db.query('DELETE FROM uploads.uploads WHERE id = $1', [id])
}

export const getUploadEntriesByrootId = async (
  root_upload_id: string,
): Promise<UploadEntry[]> => {
  const db = await getDatabase()

  const result = await db.query(
    'SELECT * FROM uploads.uploads WHERE root_upload_id = $1',
    [root_upload_id],
  )

  return result.rows
}

const getUploadEntriesByRelativeId = async (
  root_upload_id: string,
  relative_id: string,
): Promise<UploadEntry | null> => {
  const db = await getDatabase()

  const result = await db.query(
    'SELECT * FROM uploads.uploads WHERE relative_id = $1 AND root_upload_id = $2',
    [relative_id, root_upload_id],
  )

  return result.rows.at(0) ?? null
}

const getUploadsByRoot = async (uploadId: string): Promise<UploadEntry[]> => {
  const db = await getDatabase()

  const result = await db.query(
    'SELECT * FROM uploads.uploads WHERE root_upload_id = $1',
    [uploadId],
  )

  return result.rows
}

const getUploadsByStatus = async (
  status: UploadStatus,
  limit: number = 100,
): Promise<UploadEntry[]> => {
  const db = await getDatabase()

  const result = await db.query(
    'SELECT * FROM uploads.uploads WHERE id = root_upload_id AND status = $1 LIMIT $2',
    [status, limit],
  )

  return result.rows
}

const getStatusByCID = async (cid: string): Promise<UploadStatus | null> => {
  const db = await getDatabase()
  const result = await db.query<{
    status: UploadStatus
  }>(
    'SELECT status FROM uploads.uploads LEFT JOIN uploads.blockstore ON uploads.uploads.id = uploads.blockstore.upload_id WHERE uploads.blockstore.cid = $1',
    [cid],
  )

  return result.rows.at(0)?.status ?? null
}

const deleteEntriesByRootUploadId = async (
  rootUploadId: string,
): Promise<void> => {
  const db = await getDatabase()

  await db.query('DELETE FROM uploads.uploads WHERE root_upload_id = $1', [
    rootUploadId,
  ])
}

// Root uploads still MIGRATING whose last touch predates the staleness
// window. updated_at is stamped when the upload completes and again on each
// recovery attempt (the set_timestamp trigger is AFTER UPDATE and therefore a
// no-op, so these explicit writes are authoritative). The window both excludes
// freshly-enqueued migrations and rate-limits re-drives.
const getStuckRootMigrations = async (
  stalenessMs: number,
  limit: number,
): Promise<string[]> => {
  const db = await getDatabase()

  const result = await db.query<{ id: string }>(
    `SELECT id FROM uploads.uploads
      WHERE status = $1
        AND id = root_upload_id
        AND updated_at < NOW() - (INTERVAL '1 millisecond' * $2)
      ORDER BY updated_at ASC
      LIMIT $3`,
    [UploadStatus.MIGRATING, stalenessMs, limit],
  )

  return result.rows.map((row) => row.id)
}

// Stamp updated_at so the given root uploads drop out of
// getStuckRootMigrations for a full staleness window after a recovery attempt.
const markMigrationRecoveryAttempt = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return
  const db = await getDatabase()

  await db.query(
    `UPDATE uploads.uploads SET updated_at = NOW()
      WHERE id = ANY($1) AND id = root_upload_id AND status = $2`,
    [ids, UploadStatus.MIGRATING],
  )
}

export const uploadsRepository = {
  createUploadEntry,
  getUploadEntryById,
  updateUploadEntry,
  deleteUploadEntry,
  getUploadsByRoot,
  getUploadEntriesByRelativeId,
  getUploadsByStatus,
  getStatusByCID,
  updateUploadStatusByRootUploadId,
  deleteEntriesByRootUploadId,
  getStuckRootMigrations,
  markMigrationRecoveryAttempt,
}
