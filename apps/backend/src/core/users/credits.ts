import { PurchasedCredit, User, UserRole, UserWithOrganization } from '@auto-drive/models'
import {
  AdminCreditBatchRow,
  AdminUserCreditBatchRow,
  purchasedCreditsRepository,
} from '../../infrastructure/repositories/users/purchasedCredits.js'
import { AccountsUseCases } from './accounts.js'
import { config } from '../../config.js'
import { ForbiddenError, NotFoundError } from '../../errors/index.js'
import { err, ok, Result } from 'neverthrow'
import { hasGoogleAuth } from '../featureFlags/index.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('CreditsUseCases')

// Number of days ahead to consider a batch "expiring soon" for the
// /credits/batches/expiring endpoint and the economics admin view.
const EXPIRING_WITHIN_DAYS = 30

// ---------------------------------------------------------------------------
// CreditSummary
// Returned by GET /credits/summary.
// ---------------------------------------------------------------------------

export type CreditSummary = {
  uploadBytesRemaining: bigint
  /** Total originally-purchased upload bytes across all active (non-expired) rows. */
  totalPurchasedBytesOriginal: bigint
  downloadBytesRemaining: bigint
  /** Soonest expires_at across active rows, or null when no active credits. */
  nextExpiryDate: Date | null
  /** Number of active (non-expired) purchase rows. */
  batchCount: number
  /**
   * True when the user can still make a purchase without exceeding the cap.
   * Cap is enforced on upload bytes only — download credits are not allocated
   * on purchase right now, so only uploadBytesRemaining is checked.
   */
  canPurchase: boolean
  /** Maximum bytes the user could purchase right now without hitting the cap. */
  maxPurchasableBytes: bigint
  /** True when the user is authenticated via Google OAuth. */
  googleVerified: boolean
  /**
   * Number of days after purchase before credits expire.
   * Driven by the CREDIT_EXPIRY_DAYS environment variable so the frontend
   * can display the correct duration without a separate API call.
   */
  expiryDays: number
}

const getSummary = async (
  user: UserWithOrganization,
): Promise<CreditSummary> => {
  const account = await AccountsUseCases.getOrCreateAccount(user)
  const summary = await purchasedCreditsRepository.getRemainingCredits(account.id)

  const cap = config.credits.maxBytesPerUser

  // Cap is enforced on upload bytes only. Download credits are not allocated
  // on purchase right now so there is no download cap to check.
  const maxPurchasableBytes =
    cap > summary.uploadBytesRemaining ? cap - summary.uploadBytesRemaining : 0n
  const canPurchase = maxPurchasableBytes > 0n

  return {
    uploadBytesRemaining: summary.uploadBytesRemaining,
    totalPurchasedBytesOriginal: summary.uploadBytesOriginal,
    downloadBytesRemaining: summary.downloadBytesRemaining,
    nextExpiryDate: summary.nextExpiryDate,
    batchCount: summary.activeRowCount,
    canPurchase,
    maxPurchasableBytes,
    googleVerified: hasGoogleAuth(user),
    expiryDays: config.credits.expiryDays,
  }
}

// ---------------------------------------------------------------------------
// getBatches
// Full purchase history (including expired rows) for the authenticated user.
// Returned by GET /credits/batches.
// ---------------------------------------------------------------------------

const getBatches = async (
  user: UserWithOrganization,
): Promise<PurchasedCredit[]> => {
  const account = await AccountsUseCases.getOrCreateAccount(user)
  return purchasedCreditsRepository.getByAccountId(account.id)
}

// ---------------------------------------------------------------------------
// getExpiringBatches
// Active rows expiring within EXPIRING_WITHIN_DAYS for the authenticated user.
// Returned by GET /credits/batches/expiring.
// ---------------------------------------------------------------------------

const getExpiringBatches = async (
  user: UserWithOrganization,
): Promise<PurchasedCredit[]> => {
  const account = await AccountsUseCases.getOrCreateAccount(user)
  return purchasedCreditsRepository.getExpiringCreditsByAccountId(
    account.id,
    EXPIRING_WITHIN_DAYS,
  )
}

// ---------------------------------------------------------------------------
// CreditEconomics / getEconomics
// System-wide stats for admin users only.
// Returned by GET /credits/economics.
// ---------------------------------------------------------------------------

export type CreditEconomics = {
  /** Count of active rows expiring within 30 days, system-wide. */
  totalExpiringWithin30Days: number
  /** Sum of upload bytes remaining across those rows. */
  totalExpiringUploadBytes: bigint
  /** Sum of download bytes remaining across those rows. */
  totalExpiringDownloadBytes: bigint
}

const getEconomics = async (
  executor: User,
): Promise<Result<CreditEconomics, ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    logger.warn('Non-admin user attempted to access credit economics', {
      publicId: executor.publicId,
    })
    return err(new ForbiddenError('Admin access required'))
  }

  const aggregate =
    await purchasedCreditsRepository.getExpiringCreditsAggregate(
      EXPIRING_WITHIN_DAYS,
    )

  return ok({
    totalExpiringWithin30Days: aggregate.count,
    totalExpiringUploadBytes: aggregate.totalUploadBytesRemaining,
    totalExpiringDownloadBytes: aggregate.totalDownloadBytesRemaining,
  })
}

// ---------------------------------------------------------------------------
// getAllBatches
// Admin-only: full purchase history across all users with their publicId.
// Returns 403 for non-admin callers.
// ---------------------------------------------------------------------------

const getAllBatches = async (
  executor: User,
): Promise<Result<AdminCreditBatchRow[], ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    logger.warn('Non-admin user attempted to access all credit batches', {
      publicId: executor.publicId,
    })
    return err(new ForbiddenError('Admin access required'))
  }

  const rows = await purchasedCreditsRepository.getAllWithUserPublicId()
  return ok(rows)
}

// ---------------------------------------------------------------------------
// getUserBatches
// Admin-only: full purchase history for a specific user identified by their
// userPublicId. Includes intent data (price, wallet address) for refund UX.
// Returns 403 for non-admin callers.
// ---------------------------------------------------------------------------

const getUserBatches = async (
  executor: User,
  userPublicId: string,
): Promise<Result<AdminUserCreditBatchRow[], ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }
  const rows = await purchasedCreditsRepository.getByUserPublicId(userPublicId)
  return ok(rows)
}

// ---------------------------------------------------------------------------
// refundBatch
// Admin-only: zeros the remaining bytes for a specific credit batch and marks
// it as refunded. Idempotent — calling it on an already-refunded row is a
// no-op that still returns ok() so the UI can safely retry on network errors.
// Returns 403 for non-admin callers, 404 if the batch does not exist.
// ---------------------------------------------------------------------------

const refundBatch = async (
  executor: User,
  batchId: string,
): Promise<Result<void, ForbiddenError | NotFoundError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const { found, row } = await purchasedCreditsRepository.markAsRefunded(batchId)
  if (!found) {
    return err(new NotFoundError('Credit batch not found'))
  }

  if (row) {
    logger.info('Admin marked credit batch as refunded', {
      batchId,
      adminPublicId: executor.publicId,
    })
  } else {
    logger.info('Credit batch already refunded, no-op', {
      batchId,
      adminPublicId: executor.publicId,
    })
  }

  return ok(undefined)
}

export const CreditsUseCases = {
  getSummary,
  getBatches,
  getExpiringBatches,
  getEconomics,
  getAllBatches,
  getUserBatches,
  refundBatch,
}
