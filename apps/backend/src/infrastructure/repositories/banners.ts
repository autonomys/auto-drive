import {
  Banner,
  BannerInteraction,
  BannerInteractionType,
  BannerCriticality,
  BannerWithStats,
} from '@auto-drive/models'
import { getDatabase } from '../drivers/pg.js'

// ---------------------------------------------------------------------------
// Internal DB row types
// ---------------------------------------------------------------------------

type DBBanner = {
  id: string
  title: string
  body: string
  criticality: string
  dismissable: boolean
  requires_acknowledgement: boolean
  display_start: Date
  display_end: Date | null
  active: boolean
  created_by: string
  created_at: Date
  updated_at: Date
}

type DBBannerInteraction = {
  id: string
  user_id: string
  banner_id: string
  interaction_type: string
  created_at: Date
}

const mapBannerRow = (row: DBBanner): Banner => ({
  id: row.id,
  title: row.title,
  body: row.body,
  criticality: row.criticality as BannerCriticality,
  dismissable: row.dismissable,
  requiresAcknowledgement: row.requires_acknowledgement,
  displayStart: row.display_start,
  displayEnd: row.display_end,
  active: row.active,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapInteractionRow = (row: DBBannerInteraction): BannerInteraction => ({
  id: row.id,
  userId: row.user_id,
  bannerId: row.banner_id,
  interactionType: row.interaction_type as BannerInteractionType,
  createdAt: row.created_at,
})

// ---------------------------------------------------------------------------
// createBanner
// ---------------------------------------------------------------------------

type CreateBannerParams = {
  title: string
  body: string
  criticality: BannerCriticality
  dismissable: boolean
  requiresAcknowledgement: boolean
  displayStart: Date
  displayEnd: Date | null
  active: boolean
  createdBy: string
}

const createBanner = async (params: CreateBannerParams): Promise<Banner> => {
  const db = await getDatabase()
  const result = await db.query<DBBanner>(
    `INSERT INTO banners (
       title, body, criticality, dismissable, requires_acknowledgement,
       display_start, display_end, active, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      params.title,
      params.body,
      params.criticality,
      params.dismissable,
      params.requiresAcknowledgement,
      params.displayStart,
      params.displayEnd,
      params.active,
      params.createdBy,
    ],
  )
  return mapBannerRow(result.rows[0])
}

// ---------------------------------------------------------------------------
// updateBanner
// ---------------------------------------------------------------------------

type UpdateBannerParams = {
  title?: string
  body?: string
  criticality?: BannerCriticality
  dismissable?: boolean
  requiresAcknowledgement?: boolean
  displayStart?: Date
  displayEnd?: Date | null
  active?: boolean
}

const updateBanner = async (
  id: string,
  params: UpdateBannerParams,
): Promise<Banner | null> => {
  const fields: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (params.title !== undefined) {
    fields.push(`title = $${idx++}`)
    values.push(params.title)
  }
  if (params.body !== undefined) {
    fields.push(`body = $${idx++}`)
    values.push(params.body)
  }
  if (params.criticality !== undefined) {
    fields.push(`criticality = $${idx++}`)
    values.push(params.criticality)
  }
  if (params.dismissable !== undefined) {
    fields.push(`dismissable = $${idx++}`)
    values.push(params.dismissable)
  }
  if (params.requiresAcknowledgement !== undefined) {
    fields.push(`requires_acknowledgement = $${idx++}`)
    values.push(params.requiresAcknowledgement)
  }
  if (params.displayStart !== undefined) {
    fields.push(`display_start = $${idx++}`)
    values.push(params.displayStart)
  }
  if (params.displayEnd !== undefined) {
    fields.push(`display_end = $${idx++}`)
    values.push(params.displayEnd)
  }
  if (params.active !== undefined) {
    fields.push(`active = $${idx++}`)
    values.push(params.active)
  }

  if (fields.length === 0) return null

  fields.push('updated_at = NOW()')
  values.push(id)

  const db = await getDatabase()
  const result = await db.query<DBBanner>(
    `UPDATE banners SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  )

  return result.rows[0] ? mapBannerRow(result.rows[0]) : null
}

// ---------------------------------------------------------------------------
// getBannerById
// ---------------------------------------------------------------------------

const getBannerById = async (id: string): Promise<Banner | null> => {
  const db = await getDatabase()
  const result = await db.query<DBBanner>(
    'SELECT * FROM banners WHERE id = $1',
    [id],
  )
  return result.rows[0] ? mapBannerRow(result.rows[0]) : null
}

// ---------------------------------------------------------------------------
// getAllBanners — admin listing
// ---------------------------------------------------------------------------

const getAllBanners = async (): Promise<Banner[]> => {
  const db = await getDatabase()
  const result = await db.query<DBBanner>(
    'SELECT * FROM banners ORDER BY created_at DESC',
  )
  return result.rows.map(mapBannerRow)
}

// ---------------------------------------------------------------------------
// getActiveBannersForUser
// Returns currently active banners that the user has not yet interacted with.
// ---------------------------------------------------------------------------

const getActiveBannersForUser = async (
  userId: string,
): Promise<Banner[]> => {
  const db = await getDatabase()
  const result = await db.query<DBBanner>(
    `SELECT b.* FROM banners b
     LEFT JOIN banner_interactions bi
       ON bi.banner_id = b.id AND bi.user_id = $1
     WHERE b.active = true
       AND b.display_start <= NOW()
       AND (b.display_end IS NULL OR b.display_end >= NOW())
       AND bi.id IS NULL
     ORDER BY
       CASE b.criticality
         WHEN 'critical' THEN 0
         WHEN 'warning' THEN 1
         WHEN 'info' THEN 2
       END`,
    [userId],
  )
  return result.rows.map(mapBannerRow)
}

// ---------------------------------------------------------------------------
// createInteraction — idempotent via ON CONFLICT DO NOTHING
// ---------------------------------------------------------------------------

const createInteraction = async (
  userId: string,
  bannerId: string,
  interactionType: BannerInteractionType,
): Promise<BannerInteraction | null> => {
  const db = await getDatabase()
  const result = await db.query<DBBannerInteraction>(
    `INSERT INTO banner_interactions (user_id, banner_id, interaction_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, banner_id, interaction_type) DO NOTHING
     RETURNING *`,
    [userId, bannerId, interactionType],
  )
  return result.rows[0] ? mapInteractionRow(result.rows[0]) : null
}

// ---------------------------------------------------------------------------
// getBannerWithStats — banner + interaction counts for admin view
// ---------------------------------------------------------------------------

const getBannerWithStats = async (
  id: string,
): Promise<BannerWithStats | null> => {
  const db = await getDatabase()

  const bannerResult = await db.query<DBBanner>(
    'SELECT * FROM banners WHERE id = $1',
    [id],
  )
  if (!bannerResult.rows[0]) return null

  const statsResult = await db.query<{
    interaction_type: string
    count: string
  }>(
    `SELECT interaction_type, COUNT(*) as count
     FROM banner_interactions
     WHERE banner_id = $1
     GROUP BY interaction_type`,
    [id],
  )

  let acknowledgementCount = 0
  let dismissalCount = 0
  for (const row of statsResult.rows) {
    if (row.interaction_type === 'acknowledged') {
      acknowledgementCount = Number(row.count)
    } else if (row.interaction_type === 'dismissed') {
      dismissalCount = Number(row.count)
    }
  }

  return {
    ...mapBannerRow(bannerResult.rows[0]),
    acknowledgementCount,
    dismissalCount,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const bannersRepository = {
  createBanner,
  updateBanner,
  getBannerById,
  getAllBanners,
  getActiveBannersForUser,
  createInteraction,
  getBannerWithStats,
}
