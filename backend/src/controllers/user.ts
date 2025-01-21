import { Router } from 'express'
import { handleAuth } from '../services/auth/express.js'
import { SubscriptionsUseCases } from '../useCases/users/subscriptions.js'

const subscriptionController = Router()

subscriptionController.get('/@me', async (req, res) => {
  const user = await handleAuth(req, res)
  if (!user) {
    return
  }

  try {
    const subscriptionInfo =
      await SubscriptionsUseCases.getSubscriptionInfo(user)

    res.json(subscriptionInfo)
  } catch (error) {
    console.error(error)
    res.status(500).json({
      error: 'Failed to get user info',
    })
    return
  }
})

export { subscriptionController }
