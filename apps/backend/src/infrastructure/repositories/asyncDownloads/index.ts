import { getDatabase } from '../../drivers/pg.js'
import { AsyncDownload, AsyncDownloadStatus } from '@auto-drive/models'

interface AsyncDownloadDB {
  id: string
  oauth_provider: string
  oauth_user_id: string
  cid: string
  status: AsyncDownloadStatus
  error_message: string | null
  file_size: string | null
  downloaded_bytes: string | null
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
  fileSize: db.file_size ?? '0',
  downloadedBytes: db.downloaded_bytes ?? '0',
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

const getUndismissedDownloadsByUser = async (
  oauth_provider: string,
  oauth_user_id: string,
): Promise<AsyncDownload[]> => {
  const db = await getDatabase()

  const downloads = await db.query(
    'SELECT * FROM public.async_downloads WHERE oauth_provider = $1 AND oauth_user_id = $2 AND status != $3 ORDER BY created_at DESC',
    [oauth_provider, oauth_user_id, AsyncDownloadStatus.Dismissed],
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

/**
 * The most recent still-running reconstruction for this cid, regardless of who
 * asked for it. The cache is shared, so one user's in-flight job is the answer
 * to every other user's "is this being fetched?" — without this the status
 * endpoint can only say "not cached", which reads as "broken" while a
 * reconstruction is minutes into running.
 *
 * "Still running" has to mean recently alive, not merely Pending or
 * Downloading. A worker that dies mid-pull, or a task that never arrives,
 * leaves a row in one of those states forever — and since this query is not
 * scoped to a user, one such row would tell every user that the cid is already
 * being fetched, disabling their own request permanently and leaving only its
 * owner able to dismiss it. The running worker stamps updated_at (see
 * touchDownload), so anything older than staleAfterMs is a corpse.
 */
const getActiveDownloadByCid = async (
  cid: string,
  staleAfterMs: number,
): Promise<AsyncDownload | null> => {
  const db = await getDatabase()

  const download = await db.query<AsyncDownloadDB>(
    `SELECT * FROM public.async_downloads
     WHERE cid = $1 AND status IN ($2, $3)
       AND updated_at > NOW() - ($4::bigint * INTERVAL '1 millisecond')
     ORDER BY created_at DESC
     LIMIT 1`,
    [
      cid,
      AsyncDownloadStatus.Pending,
      AsyncDownloadStatus.Downloading,
      staleAfterMs,
    ],
  )

  return download.rows.map(mapAsyncDownloadDBToAsyncDownload).at(0) ?? null
}

/**
 * This user's own still-running request for this cid, used to make repeat
 * clicks idempotent. Without it every click on Download or "Bring to Cache"
 * inserts another row and publishes another task, so N clicks become N
 * concurrent full reconstructions of the same object competing for the same
 * gateway. Scoped to the user because the row is the user's own record of the
 * request — two users asking for one cid still get a row each.
 *
 * Bounded by staleAfterMs for the same reason as getActiveDownloadByCid: a dead
 * row must not make a user's every later request a no-op that hands back a job
 * nothing is working on.
 */
const getActiveDownloadByCidAndUser = async (
  cid: string,
  oauth_provider: string,
  oauth_user_id: string,
  staleAfterMs: number,
): Promise<AsyncDownload | null> => {
  const db = await getDatabase()

  const download = await db.query<AsyncDownloadDB>(
    `SELECT * FROM public.async_downloads
     WHERE cid = $1 AND oauth_provider = $2 AND oauth_user_id = $3
       AND status IN ($4, $5)
       AND updated_at > NOW() - ($6::bigint * INTERVAL '1 millisecond')
     ORDER BY created_at DESC
     LIMIT 1`,
    [
      cid,
      oauth_provider,
      oauth_user_id,
      AsyncDownloadStatus.Pending,
      AsyncDownloadStatus.Downloading,
      staleAfterMs,
    ],
  )

  return download.rows.map(mapAsyncDownloadDBToAsyncDownload).at(0) ?? null
}

/**
 * Stamps updated_at so the row still reads as alive.
 *
 * Progress writes already do this, but only once bytes are flowing: a cold
 * retrieval can spend minutes reconstructing before its first byte, and for
 * that whole window a healthy download and a dead worker are indistinguishable
 * in the table. The heartbeat is what lets the staleness bound above be short
 * enough to be useful.
 */
const touchDownload = async (id: string): Promise<void> => {
  const db = await getDatabase()

  await db.query(
    'UPDATE public.async_downloads SET updated_at = NOW() WHERE id = $1',
    [id],
  )
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
  getUndismissedDownloadsByUser,
  getDownloadByCid,
  getActiveDownloadByCid,
  getActiveDownloadByCidAndUser,
  touchDownload,
  createDownload,
  updateDownloadStatus,
  updateDownloadProgress,
  deleteDownload,
}
