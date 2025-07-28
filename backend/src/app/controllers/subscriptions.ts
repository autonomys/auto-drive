import { Router, Request, Response } from 'express'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { SubscriptionsUseCases } from '../../core/users/subscriptions.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'

const logger = createLogger('http:controllers:subscriptions')

const subscriptionController = Router()

subscriptionController.get(
  '/@me',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const subscriptionInfo = await handleInternalError(
      SubscriptionsUseCases.getSubscriptionInfo(user),
      'Failed to get subscription info',
    )
    if (subscriptionInfo.isErr()) {
      logger.error('Failed to get subscription info', subscriptionInfo.error)
      handleError(subscriptionInfo.error, res)
      return
    }

    logger.trace('Subscription info', subscriptionInfo.value)
    res.json(subscriptionInfo.value)
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

    const subscriptionByPublicId = await handleInternalError(
      SubscriptionsUseCases.getUserListSubscriptions(req.body.userPublicIds),
      'Failed to get user list subscriptions',
    )
    if (subscriptionByPublicId.isErr()) {
      logger.error(
        'Failed to get user list subscriptions',
        subscriptionByPublicId.error,
      )
      handleError(subscriptionByPublicId.error, res)
      return
    }

    logger.trace('User list subscriptions', subscriptionByPublicId.value)
    res.json(subscriptionByPublicId.value)
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

    const updateResult = await handleInternalErrorResult(
      SubscriptionsUseCases.updateSubscription(
        executor,
        publicId,
        granularity,
        uploadLimit,
        downloadLimit,
      ),
      'Failed to update subscription',
    )
    if (updateResult.isErr()) {
      logger.error('Failed to update subscription', updateResult.error)
      handleError(updateResult.error, res)
      return
    }

    logger.debug('Subscription updated', updateResult.value)
    res.json(updateResult.value)
  }),
)

export { subscriptionController }
