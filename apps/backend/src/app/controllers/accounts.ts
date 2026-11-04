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

    const userPublicIds = z
      .array(z.string())
      .max(100)
      .safeParse(req.body.userPublicIds)
    if (!userPublicIds.success) {
      res
        .status(400)
        .json({ error: 'userPublicIds must be an array of strings' })
      return
    }

    const accountByPublicId = await handleInternalErrorResult(
      AccountsUseCases.getUserListAccount(user, userPublicIds.data),
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

// Admin-only: find accounts by partial user publicId, account ID or
// organization ID. Each result carries the matching user.
accountController.get(
  '/admin/search',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (!query) {
      res.status(400).json({ error: 'Missing query parameter `q`' })
      return
    }

    const result = await handleInternalErrorResult(
      AccountsUseCases.adminSearchAccounts(user, query),
      'Failed to search accounts',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

// Admin-only: each user's current account ID, keyed by publicId.
accountController.post(
  '/admin/by-users',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const publicIds = z.array(z.string()).max(100).safeParse(req.body.publicIds)
    if (!publicIds.success) {
      res.status(400).json({ error: 'publicIds must be an array of strings' })
      return
    }

    const result = await handleInternalErrorResult(
      AccountsUseCases.adminGetAccountIdsByUsers(user, publicIds.data),
      'Failed to get accounts by users',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

// Admin-only: one account by account ID or organization ID, with its members.
accountController.get(
  '/admin/:id',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      AccountsUseCases.adminGetAccount(user, req.params.id),
      'Failed to get account',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.json(result.value)
  }),
)

accountController.get(
  '/ranking',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10
    const type = req.query.type === 'download' ? 'download' : 'upload'

    const fromDate = req.query.from
      ? new Date(parseInt(req.query.from as string))
      : null
    const toDate = req.query.to
      ? new Date(parseInt(req.query.to as string))
      : null

    if (fromDate && toDate && fromDate >= toDate) {
      return res.status(400).json({ error: 'Invalid date range' })
    }

    const accounts = await handleInternalError(
      AccountsUseCases.getTopAccounts(user, {
        limit,
        fromDate,
        toDate,
        type,
      }),
      'Failed to get top accounts',
    )
    if (accounts.isErr()) {
      logger.error('Failed to get top accounts', accounts.error)
      handleError(accounts.error, res)
      return
    }

    res.json(accounts.value)
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
