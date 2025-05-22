import { getDatabase } from '../../drivers/pg.js'
import { AsyncDownload } from '@auto-drive/models'

interface AsyncDownloadDB {
  id: string
  oauth_provider: string
  oauth_user_id: string
  cid: string
  status: string
  error_message: string | null
  file_size: bigint | null
  downloaded_bytes: bigint
  created_at: Date
  updated_at: Date
}

const mapAsyncDownloadDBToAsyncDownload = (
  db: AsyncDownloadDB,
): AsyncDownload => ({
  ...db,
  oauthProvider: db.oauth_provider,
  oauthUserId: db.oauth_user_id,
  errorMessage: db.error_message,
  fileSize: BigInt(db.file_size ?? 0n).valueOf(),
  downloadedBytes: BigInt(db.downloaded_bytes ?? 0n).valueOf(),
  createdAt: db.created_at,
  updatedAt: db.updated_at,
})

const getDownloadById = async (id: string): Promise<AsyncDownload | null> => {
  const db = await getDatabase()
  const download = await db.query(
    'SELECT * FROM public.async_downloads WHERE id = $1',
    [id],
  )

  return download.rows.map(mapAsyncDownloadDBToAsyncDownload).at(0) ?? null
}

const getDownloadsByUser = async (
  oauth_provider: string,
  oauth_user_id: string,
): Promise<AsyncDownload[]> => {
  const db = await getDatabase()

  const downloads = await db.query(
    'SELECT * FROM public.async_downloads WHERE oauth_provider = $1 AND oauth_user_id = $2 ORDER BY created_at DESC',
    [oauth_provider, oauth_user_id],
  )

  return downloads.rows.map(mapAsyncDownloadDBToAsyncDownload)
}

const getDownloadByCid = async (
  cid: string,
  oauth_provider: string,
  oauth_user_id: string,
): Promise<AsyncDownload | null> => {
  const db = await getDatabase()

  const download = await db.query(
    'SELECT * FROM public.async_downloads WHERE cid = $1 AND oauth_provider = $2 AND oauth_user_id = $3',
    [cid, oauth_provider, oauth_user_id],
  )

  return download.rows.map(mapAsyncDownloadDBToAsyncDownload).at(0) ?? null
}

const createDownload = async (
  id: string,
  oauth_provider: string,
  oauth_user_id: string,
  cid: string,
  status: string,
  fileSize: bigint,
): Promise<AsyncDownload> => {
  const db = await getDatabase()

  const download = await db.query<AsyncDownloadDB>(
    'INSERT INTO public.async_downloads (id, oauth_provider, oauth_user_id, cid, status, file_size) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [id, oauth_provider, oauth_user_id, cid, status, fileSize],
  )

  return download.rows.map(mapAsyncDownloadDBToAsyncDownload).at(0)!
}

const updateDownloadStatus = async (
  id: string,
  status: string,
  errorMessage?: string,
): Promise<AsyncDownload | null> => {
  const db = await getDatabase()

  const updateQuery = errorMessage
    ? 'UPDATE public.async_downloads SET status = $1, error_message = $2 WHERE id = $3 RETURNING *'
    : 'UPDATE public.async_downloads SET status = $1 WHERE id = $2 RETURNING *'

  const params = errorMessage ? [status, errorMessage, id] : [status, id]

  const updatedDownload = await db.query<AsyncDownloadDB>(updateQuery, params)

  return (
    updatedDownload.rows.map(mapAsyncDownloadDBToAsyncDownload).at(0) ?? null
  )
}

const updateDownloadProgress = async (
  id: string,
  downloadedBytes: bigint,
  fileSize?: bigint,
): Promise<AsyncDownload | null> => {
  const db = await getDatabase()

  const updateQuery =
    fileSize !== undefined
      ? 'UPDATE public.async_downloads SET downloaded_bytes = $1, file_size = $2 WHERE id = $3 RETURNING *'
      : 'UPDATE public.async_downloads SET downloaded_bytes = $1 WHERE id = $2 RETURNING *'

  const params =
    fileSize !== undefined
      ? [downloadedBytes, fileSize, id]
      : [downloadedBytes, id]

  const updatedDownload = await db.query<AsyncDownloadDB>(updateQuery, params)

  return (
    updatedDownload.rows.map(mapAsyncDownloadDBToAsyncDownload).at(0) ?? null
  )
}

const deleteDownload = async (id: string): Promise<boolean> => {
  const db = await getDatabase()

  const result = await db.query(
    'DELETE FROM public.async_downloads WHERE id = $1',
    [id],
  )

  return result.rowCount !== null && result.rowCount > 0
}

export const asyncDownloadsRepository = {
  getDownloadById,
  getDownloadsByUser,
  getDownloadByCid,
  createDownload,
  updateDownloadStatus,
  updateDownloadProgress,
  deleteDownload,
}
