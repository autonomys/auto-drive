import { Router } from 'express'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { CreditsUseCases } from '../../core/users/credits.js'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'
import { PurchasedCredit } from '@auto-drive/models'

export const creditsController = Router()

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

// PurchasedCredit rows contain bigint fields that cannot be JSON-serialised
// directly.  We convert each bigint to a string so the wire format is stable
// and the frontend can parse them with BigInt() or a numeric library.
const serializeCredit = (credit: PurchasedCredit) => ({
  ...credit,
  uploadBytesOriginal: credit.uploadBytesOriginal.toString(),
  uploadBytesRemaining: credit.uploadBytesRemaining.toString(),
  downloadBytesOriginal: credit.downloadBytesOriginal.toString(),
  downloadBytesRemaining: credit.downloadBytesRemaining.toString(),
})

// ---------------------------------------------------------------------------
// GET /credits/summary
// Returns the authenticated user's credit totals, next expiry, and whether
// they can still make a purchase without hitting the per-user cap.
// ---------------------------------------------------------------------------

creditsController.get(
  '/summary',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalError(
      CreditsUseCases.getSummary(user),
      'Failed to get credit summary',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    const summary = result.value
    res.status(200).json({
      uploadBytesRemaining: summary.uploadBytesRemaining.toString(),
      totalPurchasedBytesOriginal: summary.totalPurchasedBytesOriginal.toString(),
      downloadBytesRemaining: summary.downloadBytesRemaining.toString(),
      nextExpiryDate: summary.nextExpiryDate ?? null,
      batchCount: summary.batchCount,
      canPurchase: summary.canPurchase,
      maxPurchasableBytes: summary.maxPurchasableBytes.toString(),
      googleVerified: summary.googleVerified,
      expiryDays: summary.expiryDays,
    })
  }),
)

// ---------------------------------------------------------------------------
// GET /credits/batches
// Returns the full purchase history for the authenticated user, including
// already-expired rows, ordered newest-first.
// ---------------------------------------------------------------------------

creditsController.get(
  '/batches',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalError(
      CreditsUseCases.getBatches(user),
      'Failed to get credit batches',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value.map(serializeCredit))
  }),
)

// ---------------------------------------------------------------------------
// GET /credits/batches/expiring
// Returns active rows expiring within 30 days for the authenticated user.
// Useful for frontend expiry-warning banners.
// ---------------------------------------------------------------------------

creditsController.get(
  '/batches/expiring',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalError(
      CreditsUseCases.getExpiringBatches(user),
      'Failed to get expiring credit batches',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value.map(serializeCredit))
  }),
)

// ---------------------------------------------------------------------------
// GET /credits/batches/all
// Admin-only: all credit batches across every user, newest-first.
// Each row includes the owner's userPublicId for easy cross-referencing
// with the admin user table.  Returns 403 for non-admin callers.
//
// NOTE: registered BEFORE GET /credits/batches so Express does not attempt
// to match the literal string "all" against the existing /batches route
// (they are separate paths and Express won't confuse them, but ordering
// here keeps the admin routes grouped together).
// ---------------------------------------------------------------------------

creditsController.get(
  '/batches/all',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      CreditsUseCases.getAllBatches(user),
      'Failed to get all credit batches',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(
      result.value.map((batch) => ({
        ...serializeCredit(batch),
        userPublicId: batch.userPublicId,
      })),
    )
  }),
)

// ---------------------------------------------------------------------------
// GET /credits/batches/user/:userPublicId
// Admin-only: all credit batches for a specific user, newest-first.
// Each row includes intent fields (paymentAmount, shannonsPerByte, txHash,
// fromAddress) so the admin can calculate the AI3 price paid and identify
// the wallet used for the on-chain payment.
// Returns 403 for non-admin callers.
// ---------------------------------------------------------------------------

creditsController.get(
  '/batches/user/:userPublicId',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { userPublicId } = req.params

    const result = await handleInternalErrorResult(
      CreditsUseCases.getUserBatches(user, userPublicId),
      'Failed to get user credit batches',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(
      result.value.map((batch) => ({
        ...serializeCredit(batch),
        userPublicId: batch.userPublicId,
        paymentAmount: batch.paymentAmount?.toString() ?? null,
        shannonsPerByte: batch.shannonsPerByte.toString(),
        txHash: batch.txHash ?? null,
        fromAddress: batch.fromAddress ?? null,
      })),
    )
  }),
)

// ---------------------------------------------------------------------------
// POST /credits/batches/:id/refund
// Admin-only: marks a credit batch as refunded (zeros remaining bytes,
// sets refunded = true). Idempotent — safe to call multiple times.
// Returns 403 for non-admin callers, 404 if the batch is not found.
// ---------------------------------------------------------------------------

creditsController.post(
  '/batches/:id/refund',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { id } = req.params

    const result = await handleInternalErrorResult(
      CreditsUseCases.refundBatch(user, id),
      'Failed to refund credit batch',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------
// GET /credits/economics
// Admin-only: system-wide credit stats (expiring totals, byte volumes).
// Returns 403 for non-admin users.
// ---------------------------------------------------------------------------

creditsController.get(
  '/economics',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      CreditsUseCases.getEconomics(user),
      'Failed to get credit economics',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    const economics = result.value
    res.status(200).json({
      totalExpiringWithin30Days: economics.totalExpiringWithin30Days,
      totalExpiringUploadBytes: economics.totalExpiringUploadBytes.toString(),
      totalExpiringDownloadBytes:
        economics.totalExpiringDownloadBytes.toString(),
    })
  }),
)
