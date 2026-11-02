import pg from 'pg'
import { getDatabase } from '../drivers/pg.js'
import { createLogger } from '../drivers/logger.js'

type DBOrganization = {
  id: string
  name: string
  archived_at: Date | null
}

type DBOrganizationSummary = DBOrganization & {
  member_count: string
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
  db?: pg.Client,
): Promise<DBOrganization> => {
  const client = db ?? (await getDatabase())

  logger.debug('Creating organization %s', id)

  const result = await client.query<DBOrganization>(
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

// Archives an organisation once its last member has left it, keeping it and
// its account for history and for a later restore.
const archiveIfEmpty = async (id: string, db: pg.Client): Promise<void> => {
  await db.query(
    `UPDATE users.organizations SET archived_at = NOW()
     WHERE id = $1 AND archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM users.users_organizations WHERE organization_id = $1
       )`,
    [id],
  )
}

// Returns the organisation if it was archived, or null if it was not.
const unarchive = async (
  id: string,
  db: pg.Client,
): Promise<DBOrganization | null> => {
  const result = await db.query<DBOrganization>(
    `UPDATE users.organizations SET archived_at = NULL
     WHERE id = $1 AND archived_at IS NOT NULL
     RETURNING *`,
    [id],
  )
  return result.rows[0] ?? null
}

const getOrganizationSummaries = async (
  ids: string[],
): Promise<DBOrganizationSummary[]> => {
  if (ids.length === 0) return []

  const db = await getDatabase()
  const result = await db.query<DBOrganizationSummary>(
    `SELECT o.*, COUNT(m.organization_id) AS member_count
     FROM users.organizations o
     LEFT JOIN users.users_organizations m ON m.organization_id = o.id
     WHERE o.id = ANY($1::text[])
     GROUP BY o.id`,
    [ids],
  )
  return result.rows
}

export const organizationsRepository = {
  getOrganizationById,
  createOrganization,
  updateOrganizationName,
  archiveIfEmpty,
  unarchive,
  getOrganizationSummaries,
}
