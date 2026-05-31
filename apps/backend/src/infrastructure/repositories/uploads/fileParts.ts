import { getDatabase } from '../../drivers/pg.js'

interface FilePart {
  upload_id: string
  part_index: number
  data: Buffer
  created_at: Date
  updated_at: Date
}

// UPSERT rather than plain INSERT so part retries succeed.  S3 allows a
// client to re-upload the same PartNumber — typically after a transient
// network failure between the part's bytes being stored and the per-part
// ETag reaching the client — and the second call must replace the stored
// bytes rather than 500 on the (upload_id, part_index) primary key.
const addChunk = async (part: FilePart): Promise<FilePart> => {
  const db = await getDatabase()

  return db
    .query<FilePart>(
      `INSERT INTO uploads.file_parts (upload_id, part_index, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (upload_id, part_index)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING *`,
      [part.upload_id, part.part_index, part.data],
    )
    .then((result) => result.rows[0])
}

const getChunksByUploadId = async (uploadId: string): Promise<FilePart[]> => {
  const db = await getDatabase()

  return db
    .query<FilePart>('SELECT * FROM uploads.file_parts WHERE upload_id = $1', [
      uploadId,
    ])
    .then((result) => result.rows)
}

const getChunkByUploadIdAndPartIndex = async (
  uploadId: string,
  partIndex: number,
): Promise<FilePart | null> => {
  const db = await getDatabase()

  return db
    .query<FilePart>(
      'SELECT * FROM uploads.file_parts WHERE upload_id = $1 AND part_index = $2',
      [uploadId, partIndex],
    )
    .then((result) => result.rows[0])
}

// Return the part_index values strictly greater than `index` for an upload,
// WITHOUT loading the (potentially multi-GB) data column.  Used to detect a
// gap in the processed sequence at completion time; loading full part bodies
// just to read their indices would be an OOM risk on large uploads.
const getPartIndicesGreaterThan = async (
  uploadId: string,
  index: number,
): Promise<number[]> => {
  const db = await getDatabase()

  return db
    .query<{ part_index: number }>(
      `SELECT part_index FROM uploads.file_parts
       WHERE upload_id = $1 AND part_index > $2
       ORDER BY part_index`,
      [uploadId, index],
    )
    .then((result) => result.rows.map((r) => r.part_index))
}

const getUploadFilePartsSize = async (
  uploadId: string,
): Promise<bigint | null> => {
  const db = await getDatabase()

  return db
    .query<{
      total_size: string
    }>(
      'SELECT SUM(LENGTH(data)) AS total_size FROM uploads.file_parts WHERE upload_id = $1',
      [uploadId],
    )
    .then((result) => BigInt(result.rows.at(0)?.total_size ?? '0').valueOf())
}

const deleteChunksByUploadId = async (uploadId: string): Promise<void> => {
  const db = await getDatabase()

  await db.query('DELETE FROM uploads.file_parts WHERE upload_id = $1', [
    uploadId,
  ])
}

export const filePartsRepository = {
  addChunk,
  getChunksByUploadId,
  getChunkByUploadIdAndPartIndex,
  getPartIndicesGreaterThan,
  getUploadFilePartsSize,
  deleteChunksByUploadId,
}
