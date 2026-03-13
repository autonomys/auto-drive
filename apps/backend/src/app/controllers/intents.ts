import { Router } from 'express'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { IntentsUseCases } from '../../core/users/intents.js'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'
import { config } from '../../config.js'
import { hasGoogleAuth } from '../../core/featureFlags/index.js'

export const intentsController = Router()

// ---------------------------------------------------------------------------
// POST /intents/
// Creates a PENDING intent with the current price locked in.
// ---------------------------------------------------------------------------

intentsController.post(
  '/',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    // Defense-in-depth: when the feature is publicly active, intent creation
    // requires Google authentication.  The featureFlagMiddleware already blocks
    // non-Google users from reaching this route (buyCredits returns false for
    // them), but we check explicitly here to return a clear error code rather
    // than a silent 404 in case of any middleware bypass.
    if (config.featureFlags.flags.buyCredits.active && !hasGoogleAuth(user)) {
      res.status(403).json({
        error: 'GOOGLE_AUTH_REQUIRED',
        message:
          'Google authentication is required to purchase storage credits.',
      })
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

    res.status(200).json({
      ...result.value,
      shannonsPerByte: result.value.shannonsPerByte.toString(),
      paymentAmount: result.value.paymentAmount?.toString(),
    })
  }),
)

// ---------------------------------------------------------------------------
// GET /intents/over-cap  (admin only)
// Lists all intents that were confirmed on-chain but could not be converted
// to credits because the user was already at the per-user cap.
// These are terminal — the polling loop skips them.  An admin must review
// and either raise the cap + reprocess, or arrange a refund out-of-band.
//
// NOTE: this static route must be registered BEFORE GET /:id so Express does
// not match the literal string "over-cap" as a dynamic :id parameter.
// ---------------------------------------------------------------------------

intentsController.get(
  '/over-cap',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      IntentsUseCases.getOverCapIntents(user),
      'Failed to get over-cap intents',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(
      result.value.map((intent) => ({
        ...intent,
        shannonsPerByte: intent.shannonsPerByte.toString(),
        paymentAmount: intent.paymentAmount?.toString(),
      })),
    )
  }),
)

// ---------------------------------------------------------------------------
// GET /intents/:id
// ---------------------------------------------------------------------------

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
      shannonsPerByte: result.value.shannonsPerByte.toString(),
    })
  }),
)

// ---------------------------------------------------------------------------
// POST /intents/:id/watch
// Attaches a txHash to a pending intent and queues on-chain watching.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// POST /intents/:id/reprocess  (admin only)
// Resets an OVER_CAP intent back to CONFIRMED so the payment manager polling
// loop will re-attempt credit grant on its next tick (~30 s).
//
// Typical workflow:
//  1. Admin raises the user's cap via POST /accounts/update.
//  2. Admin calls this endpoint to re-queue the intent.
//  3. The polling loop picks it up within ~30 seconds.
//
// Returns 409 if the intent is not currently in OVER_CAP status, preventing
// accidental re-queuing of COMPLETED or PENDING intents.
// ---------------------------------------------------------------------------

intentsController.post(
  '/:id/reprocess',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      IntentsUseCases.reprocessOverCapIntent(user, req.params.id),
      'Failed to reprocess intent',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.sendStatus(204)
  }),
)
