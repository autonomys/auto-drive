import { getDatabase } from '../drivers/pg.js'
import { createLogger } from '../drivers/logger.js'

type DBOrganization = {
  id: string
  name: string
}

const logger = createLogger('repo:organizations')

const getOrganizationById = async (
  id: string,
): Promise<DBOrganization | null> => {
  const db = await getDatabase()
  const result = await db.query<DBOrganization>(
    'SELECT * FROM users.organizations WHERE id = $1',
    [id],
  )
  return result.rows[0] || null
}

const createOrganization = async (
  id: string,
  name: string,
): Promise<DBOrganization> => {
  const db = await getDatabase()

  logger.debug('Creating organization %s', id)

  const result = await db.query<DBOrganization>(
    'INSERT INTO users.organizations (id, name) VALUES ($1, $2) RETURNING *',
    [id, name],
  )
  return result.rows[0]
}

const updateOrganizationName = async (
  id: string,
  name: string,
): Promise<DBOrganization> => {
  const db = await getDatabase()
  const result = await db.query<DBOrganization>(
    'UPDATE users.organizations SET name = $1 WHERE id = $2 RETURNING *',
    [name, id],
  )
  return result.rows[0]
}

export const organizationsRepository = {
  getOrganizationById,
  createOrganization,
  updateOrganizationName,
}
