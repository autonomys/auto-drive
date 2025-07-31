import { getDatabase } from '../../drivers/pg.js'

export interface S3KeyMapping {
  key: string
  cid: string
  createdAt: Date
  updatedAt: Date
}

interface S3KeyMappingDB {
  key: S3KeyMapping['key']
  cid: S3KeyMapping['cid']
  created_at: S3KeyMapping['createdAt']
  updated_at: S3KeyMapping['updatedAt']
}

const mapDBToDomain = (db: S3KeyMappingDB): S3KeyMapping => ({
  key: db.key,
  cid: db.cid,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
})

const createMapping = async (
  s3Key: string,
  cid: string,
): Promise<S3KeyMapping> => {
  const db = await getDatabase()

  const result = await db.query<S3KeyMappingDB>({
    text: `
      INSERT INTO s3.object_mappings 
      ("key", cid) 
      VALUES ($1, $2)
      RETURNING *
    `,
    values: [s3Key, cid],
  })

  return result.rows.map(mapDBToDomain)[0]
}

const findByKey = async (s3Key: string): Promise<S3KeyMapping | null> => {
  const db = await getDatabase()

  const result = await db.query<S3KeyMappingDB>({
    text: `
      SELECT * FROM s3.object_mappings 
      WHERE "key" = $1
    `,
    values: [s3Key],
  })

  if (result.rows.length === 0) {
    return null
  }

  return result.rows.map(mapDBToDomain)[0]
}

const updateMapping = async (
  s3Key: string,
  newCid: string,
): Promise<S3KeyMapping> => {
  const db = await getDatabase()

  const result = await db.query<S3KeyMappingDB>({
    text: `
      UPDATE s3.object_mappings 
      SET cid = $2, updated_at = NOW()
      WHERE "key" = $1
      RETURNING *
    `,
    values: [s3Key, newCid],
  })

  if (result.rows.length === 0) {
    throw new Error(`S3 key mapping not found: ${s3Key}`)
  }

  return result.rows.map(mapDBToDomain)[0]
}

const findByCid = async (cid: string): Promise<S3KeyMapping[]> => {
  const db = await getDatabase()

  const result = await db.query<S3KeyMappingDB>({
    text: `
      SELECT * FROM s3.object_mappings 
      WHERE cid = $1
      ORDER BY "key"
    `,
    values: [cid],
  })

  return result.rows.map(mapDBToDomain)
}

export const s3ObjectMappingsRepository = {
  createMapping,
  findByKey,
  updateMapping,
  findByCid,
}
