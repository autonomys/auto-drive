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

    const accountInfo = await handleInternalError(
      AccountsUseCases.getAccountInfo(user),
      'Failed to get account info',
    )
    if (accountInfo.isErr()) {
      logger.error('Failed to get account info', accountInfo.error)
      handleError(accountInfo.error, res)
      return
    }

    logger.trace('account info', accountInfo.value)
    res.json(accountInfo.value)
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

    const accountByPublicId = await handleInternalError(
      AccountsUseCases.getUserListAccount(req.body.userPublicIds),
      'Failed to get user list accounts',
    )
    if (accountByPublicId.isErr()) {
      logger.error('Failed to get user list accounts', accountByPublicId.error)
      handleError(accountByPublicId.error, res)
      return
    }

    logger.trace('User list accounts', accountByPublicId.value)
    res.json(accountByPublicId.value)
  }),
)

accountController.post(
  '/update',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const executor = await handleAuth(req, res)
    if (!executor) {
      return
    }

    const { publicId, uploadLimit, downloadLimit, model } = req.body

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

    const safeModel = z.nativeEnum(AccountModel).safeParse(model)
    if (!safeModel.success) {
      res.status(400).json({
        error: 'Invalid model',
      })
      return
    }

    const updateResult = await handleInternalErrorResult(
      AccountsUseCases.updateAccount(
        executor,
        publicId,
        safeModel.data,
        uploadLimit,
        downloadLimit,
      ),
      'Failed to update account',
    )
    if (updateResult.isErr()) {
      logger.error('Failed to update account', updateResult.error)
      handleError(updateResult.error, res)
      return
    }

    logger.debug('Account updated', updateResult.value)
    res.json(updateResult.value)
  }),
)
