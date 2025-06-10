import express from 'express'
import { handleAuth } from '../../services/auth/express.js'
import { NotificationsUseCases } from '../../useCases/users/notifications.js'

const notificationsController = express.Router()

notificationsController.put('/@me', async (req, res) => {
  const user = await handleAuth(req, res)
  if (!user) {
    return
  }

  const { listeningNotificationIds } = req.body
  if (!Array.isArray(listeningNotificationIds)) {
    res.status(400).json({
      error: 'listeningNotificationIds must be an array',
    })
    return
  }

  const listeningNotifications =
    await NotificationsUseCases.updateListeningNotifications(
      user.publicId,
      listeningNotificationIds,
    )
  res.json(listeningNotifications)
})
