import { Router } from 'express'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { IntentsUseCases } from '../../core/users/intents.js'
import { handleInternalErrorResult } from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'
import { config } from '../../config.js'
import { hasGoogleAuth } from '../../core/featureFlags/index.js'
import { Intent, IntentMispayment } from '@auto-drive/models'

export const intentsController = Router()

// res.json() throws on a raw BigInt, so every bigint field has to be
// stringified before an intent is sent. Doing it in one place rather than at
// each response site: the fields are spread wholesale, so a field added to
// Intent and forgotten here does not fail at compile time — it throws at
// runtime, on the first request for a row that happens to have it set. The
// token_* fields are set for the first time by the USDC creation path, so this
// is now load-bearing rather than latent.
const serializeIntent = (intent: Intent) => ({
  ...intent,
  shannonsPerByte: intent.shannonsPerByte.toString(),
  paymentAmount: intent.paymentAmount?.toString(),
  tokenAmount: intent.tokenAmount?.toString(),
  quotedTokenAmount: intent.quotedTokenAmount?.toString(),
  quotedAi3Shannons: intent.quotedAi3Shannons?.toString(),
  usdRateAtCreation: intent.usdRateAtCreation?.toString(),
})

// Same reason as serializeIntent: res.json() throws on a raw BigInt.
const serializeMispayment = (mispayment: IntentMispayment) => ({
  ...mispayment,
  paymentAmount: mispayment.paymentAmount?.toString(),
  tokenAmount: mispayment.tokenAmount?.toString(),
})

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
    // requires a Google-verified account.  The featureFlagMiddleware already
    // blocks non-Google users from reaching this route (buyCredits returns
    // false for them), but we check explicitly here to return a clear error
    // code rather than a silent 404 in case of any middleware bypass.
    //
    // Note: API keys inherit the oauthProvider of the account that created
    // them, so an API key from a Google-registered account satisfies this
    // check.  This enables third-party apps to create intents server-side.
    if (config.featureFlags.flags.buyCredits.active && !hasGoogleAuth(user)) {
      res.status(403).json({
        error: 'GOOGLE_ACCOUNT_REQUIRED',
        message:
          'A Google-verified account is required to purchase storage credits. You can authenticate via Google OAuth or use an API key from a Google-registered account.',
      })
      return
    }

    // Optional: a request with no body at all is valid and behaves as it always
    // has (no size recorded, no cap pre-check). `req.body` is `{}` under
    // express.json() for a body-less request, but stays optional-chained so a
    // route mounted without the parser cannot throw here.
    const requestedBytes = IntentsUseCases.parseRequestedBytes(
      req.body?.requestedBytes,
    )
    if (requestedBytes.isErr()) {
      handleError(requestedBytes.error, res)
      return
    }

    // Absent means AI3, so a body-less request keeps its current meaning. An
    // unrecognised value is rejected rather than defaulted — see
    // parsePaymentMethod.
    const paymentMethod = IntentsUseCases.parsePaymentMethod(
      req.body?.paymentMethod,
    )
    if (paymentMethod.isErr()) {
      handleError(paymentMethod.error, res)
      return
    }

    const result = await handleInternalErrorResult(
      IntentsUseCases.createIntent(user, {
        requestedBytes: requestedBytes.value,
        paymentMethod: paymentMethod.value,
      }),
      'Failed to create intent',
    )
    if (result.isErr()) {
      // CreditCapExceededError, UsdcPaymentsDisabledError and QuoteFailedError
      // each carry their own { error: <CODE>, message } response shape, so the
      // generic path emits them — and their 400 / 403 / 503 statuses —
      // correctly.
      handleError(result.error, res)
      return
    }

    res.status(200).json(serializeIntent(result.value))
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

    res.status(200).json(result.value.map(serializeIntent))
  }),
)

// ---------------------------------------------------------------------------
// GET /intents/mispayments  (admin only)
// Lists on-chain payments written down for admin review. Mostly payments refused
// rather than attached to an intent — an unknown intent id, the wrong asset, a
// lapsed price lock, an intent another transfer already settled. The intent
// itself is untouched in every one of those, so nothing about its row records
// that money arrived; this is the only place it does.
//
// Rows with reason 'amount_off_quote' were accepted and credited; they are here
// because the amount paid differed from the amount quoted and nothing else says
// so. Filter on `reason` before working the list as a queue.
//
// NOTE: like /over-cap, this static route must be registered BEFORE GET /:id.
// ---------------------------------------------------------------------------

intentsController.get(
  '/mispayments',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      IntentsUseCases.getMispayments(user),
      'Failed to get mispayments',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value.map(serializeMispayment))
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

    res.status(200).json(serializeIntent(result.value))
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
