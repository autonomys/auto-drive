import { err, ok, Result } from 'neverthrow'
import {
  DeletionAuditEntry,
  DeletionRequest,
  IntentStatus,
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

// Runs fn while holding a lock on the organization, so that its members'
// deletions run one at a time. Without an organization there is nothing to
// share and fn runs unlocked.
const withOrganizationLock = async <T>(
  organizationId: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> => {
  if (!organizationId) return fn()

  const pool = await getDatabase()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      organizationId,
    ])
    const result = await fn()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

const anonymiseUserData = async (request: DeletionRequest): Promise<void> => {
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

  await deletionAuditRepository.createEntry(
    publicId,
    'object_ownership_anonymised',
    {
      recordsUpdated: ownershipCount,
    },
  )

  // Look up the user's account via their organization, before auth removes
  // the membership
  const user = await AuthManager.getUserFromPublicId(publicId)
  const organizationId = user.organizationId

  // A shared account's credits belong to every member, so only the last
  // member's deletion forfeits them. Deleting two members at once would let
  // both see the other, so one organization's deletions take turns: the later
  // one runs after the earlier one's membership is gone. Membership changes
  // don't take this lock; nothing changes membership after signup yet.
  // Auth removes the membership only at the end, so a failed request still
  // forfeits if it is run again. Auth never retries a failed request: it has
  // to be reset to pending by hand.
  return withOrganizationLock(organizationId, async () => {
    const account = organizationId
      ? await accountsRepository.getByOrganizationId(organizationId)
      : null
    const members = organizationId
      ? await AuthManager.getOrganizationMembers(organizationId)
      : []
    const organizationCase = members.some((member) => member !== publicId)
      ? 'shared_organization'
      : 'sole_member'
    const forfeitedAccountId =
      organizationCase === 'sole_member' ? (account?.id ?? null) : null

    // Expire the user's own pending intents, whether or not they have an
    // account. When the account is forfeited, its confirmed intents are expired
    // too, and the user's older ones that have no account and would be
    // credited to it: they would otherwise be credited afterwards. Intents go
    // before credits. A confirmation that completes first has inserted its
    // credits by the time they are expired below; one that comes later finds
    // its intent expired and inserts nothing.
    const intentsResult = await db.query<{ count: string }>(
      `WITH updated AS (
      UPDATE intents
      SET status = 'expired'
      WHERE status = ANY($3::text[])
        AND (account_id = $2
             OR (user_public_id = $1
                 AND (status = 'pending' OR account_id IS NULL)))
      RETURNING 1
    )
    SELECT COUNT(*) AS count FROM updated`,
      [
        publicId,
        forfeitedAccountId,
        forfeitedAccountId
          ? [IntentStatus.PENDING, IntentStatus.CONFIRMED]
          : [IntentStatus.PENDING],
      ],
    )
    const intentsExpired = parseInt(intentsResult.rows[0].count)

    await deletionAuditRepository.createEntry(publicId, 'intents_expired', {
      intentsExpired,
    })

    let creditsExpired = 0
    let uploadBytesForfeited = 0n
    let downloadBytesForfeited = 0n

    if (forfeitedAccountId) {
      const activeCredits =
        await purchasedCreditsRepository.getActiveByAccountId(
          forfeitedAccountId,
        )

      for (const credit of activeCredits) {
        if (!credit.expired) {
          creditsExpired++
          uploadBytesForfeited += credit.uploadBytesRemaining
          downloadBytesForfeited += credit.downloadBytesRemaining
        }
      }

      await db.query(
        `UPDATE purchased_credits
      SET expired = TRUE, updated_at = NOW()
      WHERE account_id = $1 AND expired = FALSE`,
        [forfeitedAccountId],
      )

      await deletionAuditRepository.createEntry(publicId, 'credits_expired', {
        creditsExpired,
        uploadBytesForfeited: uploadBytesForfeited.toString(),
        downloadBytesForfeited: downloadBytesForfeited.toString(),
      })
    }

    await AuthManager.executeAuthAnonymisation(request.id)

    await deletionAuditRepository.createEntry(
      publicId,
      'anonymisation_completed',
      {
        organizationCase,
        ownershipRecordsUpdated: ownershipCount,
        creditsExpired,
        uploadBytesForfeited: uploadBytesForfeited.toString(),
        downloadBytesForfeited: downloadBytesForfeited.toString(),
      },
    )

    logger.info(
      'Backend anonymisation complete for user %s: %d ownership records, %d credits expired',
      publicId,
      ownershipCount,
      creditsExpired,
    )
  })
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

    // Step 2: Anonymise backend and auth data
    await anonymiseUserData(request)

    // Step 3: Mark as completed
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
