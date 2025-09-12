import { Router } from 'express'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { intentCreationSchema } from '@auto-drive/models'
import { IntentsUseCases } from '../../core/users/intents.js'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'

export const intentsController = Router()

intentsController.post(
  '/',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const intentCreation = intentCreationSchema.safeParse(req.body)
    if (!intentCreation.success) {
      res.status(400).json({
        error: intentCreation.error.message,
      })
      return
    }

    const result = await handleInternalError(
      IntentsUseCases.createIntent(user, intentCreation.data),
      'Failed to create intent',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

intentsController.post(
  '/:id/watch',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const txHash = req.body.txHash
    if (typeof txHash !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid field: txHash',
      })
      return
    }

    const result = await handleInternalErrorResult(
      IntentsUseCases.triggerWatchIntent({
        executor: user,
        txHash,
        intentId: req.params.id,
      }),
      'Failed to confirm intent',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.sendStatus(204)
  }),
)
