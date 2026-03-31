import { err, ok, Result } from 'neverthrow'
import {
  DeletionAuditEntry,
  DeletionRequest,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { deletionAuditRepository } from '../../infrastructure/repositories/deletionAudit.js'
import { accountsRepository } from '../../infrastructure/repositories/users/accounts.js'
import { purchasedCreditsRepository } from '../../infrastructure/repositories/users/purchasedCredits.js'
import { AuthManager } from '../../infrastructure/services/auth/index.js'
import { ForbiddenError, NotFoundError } from '../../errors/index.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { getDatabase } from '../../infrastructure/drivers/pg.js'

const logger = createLogger('core:deletion')

const anonymiseBackendData = async (
  request: DeletionRequest,
): Promise<void> => {
  const db = await getDatabase()
  const publicId = request.userPublicId

  logger.info('Anonymising backend data for user %s', publicId)

  // Mark all object ownership records as deleted
  const ownershipResult = await db.query<{ count: string }>(
    `WITH updated AS (
      UPDATE object_ownership
      SET marked_as_deleted = CURRENT_TIMESTAMP
      WHERE oauth_provider = $1 AND oauth_user_id = $2
        AND marked_as_deleted IS NULL
      RETURNING 1
    )
    SELECT COUNT(*) AS count FROM updated`,
    [request.oauthProvider, request.oauthUserId],
  )
  const ownershipCount = parseInt(ownershipResult.rows[0].count)

  await deletionAuditRepository.createEntry(publicId, 'object_ownership_anonymised', {
    recordsUpdated: ownershipCount,
  })

  // Look up the user's account via their organization
  let organizationId: string | null = null
  try {
    const user = await AuthManager.getUserFromPublicId(publicId)
    organizationId = user.organizationId
  } catch {
    logger.warn('Could not resolve user %s for account lookup', publicId)
  }

  const account = organizationId
    ? await accountsRepository.getByOrganizationId(organizationId)
    : null

  let creditsExpired = 0
  let uploadBytesForfeited = 0n
  let downloadBytesForfeited = 0n

  if (account) {
    const activeCredits = await purchasedCreditsRepository.getActiveByAccountId(
      account.id,
    )

    for (const credit of activeCredits) {
      if (!credit.expired) {
        creditsExpired++
        uploadBytesForfeited += credit.uploadBytesRemaining
        downloadBytesForfeited += credit.downloadBytesRemaining
      }
    }

    if (creditsExpired > 0) {
      await db.query(
        `UPDATE purchased_credits
        SET expired = TRUE, updated_at = NOW()
        WHERE account_id = $1 AND expired = FALSE`,
        [account.id],
      )
    }

    await deletionAuditRepository.createEntry(publicId, 'credits_expired', {
      creditsExpired,
      uploadBytesForfeited: uploadBytesForfeited.toString(),
      downloadBytesForfeited: downloadBytesForfeited.toString(),
    })

    // Expire all pending intents
    const pendingIntentsResult = await db.query<{ count: string }>(
      `WITH updated AS (
        UPDATE intents
        SET status = 'expired'
        WHERE user_public_id = $1 AND status = 'pending'
        RETURNING 1
      )
      SELECT COUNT(*) AS count FROM updated`,
      [publicId],
    )
    const intentsExpired = parseInt(pendingIntentsResult.rows[0].count)

    await deletionAuditRepository.createEntry(publicId, 'intents_expired', {
      intentsExpired,
    })
  }

  await deletionAuditRepository.createEntry(publicId, 'anonymisation_completed', {
    ownershipRecordsUpdated: ownershipCount,
    creditsExpired,
    uploadBytesForfeited: uploadBytesForfeited.toString(),
    downloadBytesForfeited: downloadBytesForfeited.toString(),
  })

  logger.info(
    'Backend anonymisation complete for user %s: %d ownership records, %d credits expired',
    publicId,
    ownershipCount,
    creditsExpired,
  )
}

const processAnonymisation = async (
  request: DeletionRequest,
): Promise<void> => {
  logger.info(
    'Processing anonymisation for deletion request %s (user %s)',
    request.id,
    request.userPublicId,
  )

  try {
    // Step 1: Mark as processing (race-safe via conditional update)
    const processing = await AuthManager.markDeletionAsProcessing(request.id)
    if (!processing) {
      logger.warn(
        'Deletion request %s is no longer pending, skipping',
        request.id,
      )
      return
    }

    // Step 2: Anonymise backend data
    await anonymiseBackendData(request)

    // Step 3: Anonymise auth data
    await AuthManager.executeAuthAnonymisation(request.id)

    // Step 4: Mark as completed
    await AuthManager.markDeletionAsCompleted(request.id)

    logger.info('Anonymisation completed for deletion request %s', request.id)
  } catch (error) {
    logger.error(
      'Anonymisation failed for deletion request %s: %s',
      request.id,
      error instanceof Error ? error.message : String(error),
    )

    try {
      await AuthManager.markDeletionAsFailed(
        request.id,
        `Anonymisation failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } catch (failError) {
      logger.error(
        'Failed to mark deletion request %s as failed: %s',
        request.id,
        failError instanceof Error ? failError.message : String(failError),
      )
    }
  }
}

const getAuditLog = async (
  executor: UserWithOrganization,
  userPublicId: string,
): Promise<Result<DeletionAuditEntry[], ForbiddenError | NotFoundError>> => {
  if (executor.role !== UserRole.Admin) {
    logger.warn(
      'Non-admin %s attempted to access deletion audit log',
      executor.publicId,
    )
    return err(new ForbiddenError('Admin access required'))
  }

  const entries = await deletionAuditRepository.getByUser(userPublicId)
  return ok(entries)
}

const getStats = async (
  executor: UserWithOrganization,
): Promise<
  Result<
    { totalAnonymisations: number; recentAnonymisations: number },
    ForbiddenError
  >
> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const stats = await deletionAuditRepository.getStats()
  return ok(stats)
}

export const DeletionUseCases = {
  processAnonymisation,
  getAuditLog,
  getStats,
}
