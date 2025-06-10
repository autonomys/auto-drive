import { notificationsRepository } from '../../repositories/notifications/notifications.js'

const DEFAULT_NOTIFICATION_IDS = ['notification.credits.low']

const getListeningNotifications = async (publicId: string) => {
  const notificationConfig =
    await notificationsRepository.getListeningNotifications(publicId)

  if (!notificationConfig) {
    await notificationsRepository.createNotification(
      publicId,
      DEFAULT_NOTIFICATION_IDS,
    )
    return DEFAULT_NOTIFICATION_IDS
  }

  return notificationConfig.listeningNotificationIds
}

const updateListeningNotifications = async (
  publicId: string,
  listeningNotificationIds: string[],
) => {
  const notificationConfig =
    await notificationsRepository.updateListeningNotifications(
      publicId,
      listeningNotificationIds,
    )

  return notificationConfig.listeningNotificationIds
}

export const NotificationsUseCases = {
  getListeningNotifications,
  updateListeningNotifications,
}
