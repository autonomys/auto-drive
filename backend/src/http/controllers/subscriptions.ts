import { Router, Request, Response } from 'express'
import { handleAuth } from '../../services/auth/express.js'
import { SubscriptionsUseCases } from '../../useCases/users/subscriptions.js'
import { asyncSafeHandler } from '../../utils/express.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('http:controllers:subscriptions')

const subscriptionController = Router()

subscriptionController.get(
  '/@me',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    try {
      const subscriptionInfo =
        await SubscriptionsUseCases.getSubscriptionInfo(user)

      res.json(subscriptionInfo)
    } catch (error) {
      logger.error('Failed to get user info', error)
      res.status(500).json({
        error: 'Failed to get user info',
      })
      return
    }
  }),
)

subscriptionController.post(
  '/list',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    if (!req.body.userPublicIds) {
      res.status(400).json({ error: 'userPublicIds is required' })
      return
    }

    const subscriptionByPublicId =
      await SubscriptionsUseCases.getUserListSubscriptions(
        req.body.userPublicIds,
      )

    res.json(subscriptionByPublicId)
  }),
)

subscriptionController.post(
  '/update',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const executor = await handleAuth(req, res)
    if (!executor) {
      return
    }

    const { publicId, uploadLimit, downloadLimit, granularity } = req.body

    if (typeof publicId !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid attribute `publicId` in body',
      })
      return
    }

    if (typeof uploadLimit !== 'number') {
      res.status(400).json({
        error: 'Missing or invalid attribute `uploadLimit` in body',
      })
      return
    }

    if (typeof downloadLimit !== 'number') {
      res.status(400).json({
        error: 'Missing or invalid attribute `downloadLimit` in body',
      })
      return
    }

    if (granularity !== 'monthly') {
      // TODO: support other granularities
      res.status(400).json({
        error: 'Invalid granularity',
      })
      return
    }

    const subscription = await SubscriptionsUseCases.updateSubscription(
      executor,
      publicId,
      granularity,
      uploadLimit,
      downloadLimit,
    )

    res.json(subscription)
  }),
)

export { subscriptionController }
