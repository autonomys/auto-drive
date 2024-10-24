import { getDatabase } from "../../drivers/pg.js";

export interface FileProcessingInfo {
  upload_id: string;
  last_processed_part_index: number | null;
  last_processed_part_offset: number | null;
  created_at: Date;
  updated_at: Date;
}

const addFileProcessingInfo = async (
  fileProcessingInfo: FileProcessingInfo
): Promise<FileProcessingInfo> => {
  const db = await getDatabase();

  const result = await db.query(
    `INSERT INTO uploads.file_processing_info (upload_id, last_processed_part_index, last_processed_part_offset, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
    [
      fileProcessingInfo.upload_id,
      fileProcessingInfo.last_processed_part_index,
      fileProcessingInfo.last_processed_part_offset,
      fileProcessingInfo.created_at,
      fileProcessingInfo.updated_at,
    ]
  );

  return result.rows[0];
};

const updateFileProcessingInfo = async (
  fileProcessingInfo: FileProcessingInfo
): Promise<FileProcessingInfo> => {
  const db = await getDatabase();

  const result = await db.query(
    `UPDATE uploads.file_processing_info SET last_processed_part_index = $1, last_processed_part_offset = $2, updated_at = $3 WHERE upload_id = $4`,
    [
      fileProcessingInfo.last_processed_part_index,
      fileProcessingInfo.last_processed_part_offset,
      fileProcessingInfo.updated_at,
      fileProcessingInfo.upload_id,
    ]
  );

  return result.rows[0];
};

const getFileProcessingInfoByUploadId = async (
  uploadId: string
): Promise<FileProcessingInfo | null> => {
  const db = await getDatabase();

  const result = await db.query(
    `SELECT * FROM uploads.file_processing_info WHERE upload_id = $1`,
    [uploadId]
  );

  return result.rows[0] ?? null;
  1;
};

export const fileProcessingInfoRepository = {
  addFileProcessingInfo,
  updateFileProcessingInfo,
  getFileProcessingInfoByUploadId,
};
