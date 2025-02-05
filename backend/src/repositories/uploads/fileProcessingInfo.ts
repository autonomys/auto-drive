import { getDatabase } from '../../drivers/pg.js'

export interface FileProcessingInfo {
  upload_id: string
  last_processed_part_index: number | null
  pending_bytes: Buffer | null
  created_at: Date
  updated_at: Date
}

const addFileProcessingInfo = async (
  fileProcessingInfo: FileProcessingInfo,
): Promise<FileProcessingInfo> => {
  const db = await getDatabase()

  const result = await db.query(
    'INSERT INTO uploads.file_processing_info (upload_id, last_processed_part_index, pending_bytes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
    [
      fileProcessingInfo.upload_id,
      fileProcessingInfo.last_processed_part_index,
      fileProcessingInfo.pending_bytes,
      fileProcessingInfo.created_at,
      fileProcessingInfo.updated_at,
    ],
  )

  return result.rows[0]
}

const updateFileProcessingInfo = async (
  fileProcessingInfo: FileProcessingInfo,
): Promise<FileProcessingInfo> => {
  const db = await getDatabase()

  const result = await db.query(
    'UPDATE uploads.file_processing_info SET last_processed_part_index = $1, pending_bytes = $2, updated_at = $3 WHERE upload_id = $4',
    [
      fileProcessingInfo.last_processed_part_index,
      fileProcessingInfo.pending_bytes,
      fileProcessingInfo.updated_at,
      fileProcessingInfo.upload_id,
    ],
  )

  return result.rows[0]
}

const getFileProcessingInfoByUploadId = async (
  uploadId: string,
): Promise<FileProcessingInfo | null> => {
  const db = await getDatabase()

  const result = await db.query(
    'SELECT * FROM uploads.file_processing_info WHERE upload_id = $1',
    [uploadId],
  )

  return result.rows[0] ?? null
}

const deleteFileProcessingInfo = async (uploadId: string): Promise<void> => {
  const db = await getDatabase()

  await db.query(
    'DELETE FROM uploads.file_processing_info WHERE upload_id = $1',
    [uploadId],
  )
}

export const fileProcessingInfoRepository = {
  addFileProcessingInfo,
  updateFileProcessingInfo,
  getFileProcessingInfoByUploadId,
  deleteFileProcessingInfo,
}
