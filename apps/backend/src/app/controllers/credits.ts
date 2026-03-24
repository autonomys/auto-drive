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
