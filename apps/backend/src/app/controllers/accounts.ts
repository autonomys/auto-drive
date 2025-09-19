import { Router, Request, Response } from 'express'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { AccountsUseCases } from '../../core/users/accounts.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'
import { AccountModel } from '@auto-drive/models'
import { z } from 'zod'

const logger = createLogger('http:controllers:accounts')

export const accountController = Router()

accountController.get(
  '/@me',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const subscriptionInfo = await handleInternalError(
      AccountsUseCases.getSubscriptionInfo(user),
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

accountController.post(
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
      AccountsUseCases.getUserListAccount(req.body.userPublicIds),
      'Failed to get user list accounts',
    )
    if (subscriptionByPublicId.isErr()) {
      logger.error(
        'Failed to get user list accounts',
        subscriptionByPublicId.error,
      )
      handleError(subscriptionByPublicId.error, res)
      return
    }

    logger.trace('User list accounts', subscriptionByPublicId.value)
    res.json(subscriptionByPublicId.value)
  }),
)

accountController.post(
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

    const safeGranularity = z.nativeEnum(AccountModel).safeParse(granularity)
    if (!safeGranularity.success) {
      res.status(400).json({
        error: 'Invalid granularity',
      })
      return
    }

    const updateResult = await handleInternalErrorResult(
      AccountsUseCases.updateAccount(
        executor,
        publicId,
        safeGranularity.data,
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
