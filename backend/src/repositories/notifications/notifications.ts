import { getDatabase } from '../../drivers/pg.js'

type DBNotificationConfig = {
  public_id: string
  listening_notification_ids: string[]
  created_at: string
  updated_at: string
}

type NotificationConfig = {
  publicId: string
  listeningNotificationIds: string[]
  createdAt: string
  updatedAt: string
}

const mapRows = (rows: DBNotificationConfig[]): NotificationConfig[] => {
  return rows.map((row) => ({
    publicId: row.public_id,
    listeningNotificationIds: row.listening_notification_ids,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

const getListeningNotifications = async (
  publicId: string,
): Promise<NotificationConfig | undefined> => {
  const db = await getDatabase()
  const result = await db.query<DBNotificationConfig>(
    'SELECT * FROM notifications WHERE public_id = $1',
    [publicId],
  )

  return mapRows(result.rows).at(0)
}

const createNotification = async (
  publicId: string,
  listeningNotificationIds: string[],
): Promise<NotificationConfig> => {
  const db = await getDatabase()
  const result = await db.query<DBNotificationConfig>(
    'INSERT INTO notifications (public_id, listening_notification_ids) VALUES ($1, $2) RETURNING *',
    [publicId, listeningNotificationIds],
  )

  return mapRows(result.rows)[0]
}

const updateListeningNotifications = async (
  publicId: string,
  listeningNotificationIds: string[],
): Promise<NotificationConfig> => {
  const db = await getDatabase()
  const result = await db.query<DBNotificationConfig>(
    'UPDATE notifications SET listening_notification_ids = $1, updated_at = CURRENT_TIMESTAMP WHERE public_id = $2 RETURNING *',
    [listeningNotificationIds, publicId],
  )

  return mapRows(result.rows)[0]
}

export const notificationsRepository = {
  getListeningNotifications,
  updateListeningNotifications,
  createNotification,
}
