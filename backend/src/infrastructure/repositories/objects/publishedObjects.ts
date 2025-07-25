import { getDatabase } from '../../drivers/pg.js'

type DBPublishedObject = {
  id: string
  public_id: string
  cid: string
  created_at: string
  updated_at: string
}

export type PublishedObject = {
  id: string
  publicId: string
  cid: string
}

const mapToPublishedObject = (
  dbPublishedObject: DBPublishedObject,
): PublishedObject => {
  return {
    id: dbPublishedObject.id,
    publicId: dbPublishedObject.public_id,
    cid: dbPublishedObject.cid,
  }
}

const createPublishedObject = async (
  id: string,
  publicId: string,
  cid: string,
): Promise<PublishedObject> => {
  const db = await getDatabase()
  const result = await db.query<DBPublishedObject>(
    'INSERT INTO public.published_objects (id, public_id, cid) VALUES ($1, $2, $3) RETURNING *',
    [id, publicId, cid],
  )
  return result.rows.map(mapToPublishedObject)[0]
}

const getPublishedObjectById = async (
  id: string,
): Promise<PublishedObject | null> => {
  const db = await getDatabase()
  const result = await db.query<DBPublishedObject>(
    'SELECT * FROM public.published_objects WHERE id = $1',
    [id],
  )
  return result.rows.map(mapToPublishedObject)[0] || null
}

const getPublishedObjectByCid = async (
  cid: string,
): Promise<PublishedObject | null> => {
  const db = await getDatabase()
  const result = await db.query<DBPublishedObject>(
    'SELECT * FROM public.published_objects WHERE cid = $1',
    [cid],
  )
  return result.rows.map(mapToPublishedObject).at(0) || null
}

const updatePublishedObject = async (
  id: string,
  publicId: string,
  cid: string,
): Promise<PublishedObject> => {
  const db = await getDatabase()
  const result = await db.query<DBPublishedObject>(
    'UPDATE public.published_objects SET public_id = $1, cid = $2 WHERE id = $3 RETURNING *',
    [publicId, cid, id],
  )
  return result.rows.map(mapToPublishedObject)[0]
}

const deletePublishedObjectByCid = async (cid: string): Promise<void> => {
  const db = await getDatabase()
  await db.query('DELETE FROM public.published_objects WHERE cid = $1', [cid])
}

export const publishedObjectsRepository = {
  createPublishedObject,
  getPublishedObjectById,
  updatePublishedObject,
  deletePublishedObjectByCid,
  getPublishedObjectByCid,
}
