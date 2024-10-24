import { getDatabase } from "../../drivers/pg.js";

interface FilePart {
  upload_id: string;
  part_index: number;
  data: Buffer;
  created_at: Date;
  updated_at: Date;
}

const addChunk = async (part: FilePart): Promise<FilePart> => {
  const db = await getDatabase();

  return db
    .query<FilePart>(
      `INSERT INTO uploads.file_parts (upload_id, part_index, data) VALUES ($1, $2, $3) RETURNING *`,
      [part.upload_id, part.part_index, part.data]
    )
    .then((result) => result.rows[0]);
};

const getChunksByUploadId = async (uploadId: string): Promise<FilePart[]> => {
  const db = await getDatabase();

  return db
    .query<FilePart>(`SELECT * FROM uploads.file_parts WHERE upload_id = $1`, [
      uploadId,
    ])
    .then((result) => result.rows);
};

const getChunkByUploadIdAndPartIndex = async (
  uploadId: string,
  partIndex: number
): Promise<FilePart | null> => {
  const db = await getDatabase();

  return db
    .query<FilePart>(
      `SELECT * FROM uploads.file_parts WHERE upload_id = $1 AND part_index = $2`,
      [uploadId, partIndex]
    )
    .then((result) => result.rows[0]);
};

export const filePartsRepository = {
  addChunk,
  getChunksByUploadId,
  getChunkByUploadIdAndPartIndex,
};
