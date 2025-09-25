import { Router } from 'express'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
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

    const result = await handleInternalError(
      IntentsUseCases.createIntent(user),
      'Failed to create intent',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

intentsController.get(
  '/price',
  asyncSafeHandler(async (req, res) => {
    const result = await handleInternalError(
      new Promise<{ price: number }>((resolve) =>
        resolve(IntentsUseCases.getPrice()),
      ),
      'Failed to get price',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

intentsController.get(
  '/:id',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      IntentsUseCases.getIntent(user, req.params.id),
      'Failed to get intent',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json({
      ...result.value,
      paymentAmount: result.value.paymentAmount?.toString(),
    })
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
