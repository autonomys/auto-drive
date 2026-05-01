import { createHash } from 'crypto'
import { User, DeletionRequestStatus, DeletionRequest, DeletionRequestWithUser } from '@auto-drive/models'
import { deletionRequestsRepository, DeletionRequestRow, DeletionRequestWithUserRow } from '../repositories/deletionRequests.js'
import { usersRepository } from '../repositories/users.js'
import { apiKeysRepository } from '../repositories/apikeys.js'
import { organizationMembersRepository } from '../repositories/organizationMembers.js'
import { UsersUseCases } from './users.js'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('useCases:deletion')

const GRACE_PERIOD_DAYS = 30

const mapRowToDeletionRequest = (row: DeletionRequestRow): DeletionRequest => ({
  id: row.id,
  userPublicId: row.user_public_id,
  oauthProvider: row.oauth_provider,
  oauthUserId: row.oauth_user_id,
  status: row.status,
  requestedAt: row.requested_at,
  scheduledAnonymisationAt: row.scheduled_anonymisation_at,
  completedAt: row.completed_at,
  cancelledAt: row.cancelled_at,
  reason: row.reason,
  adminNotes: row.admin_notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapRowToDeletionRequestWithUser = (
  row: DeletionRequestWithUserRow,
): DeletionRequestWithUser => ({
  ...mapRowToDeletionRequest(row),
  oauthUsername: row.oauth_username,
})

const hashPublicId = (publicId: string): string =>
  createHash('sha256').update(publicId).digest('hex').slice(0, 16)

const requestDeletion = async (
  user: User,
  reason?: string,
): Promise<DeletionRequest> => {
  logger.info('Deletion requested by user %s', user.publicId)

  const existing = await deletionRequestsRepository.getPendingByUser(
    user.oauthProvider,
    user.oauthUserId,
  )
  if (existing) {
    logger.warn('User %s already has a pending deletion request', user.publicId)
    return mapRowToDeletionRequest(existing)
  }

  const scheduledAt = new Date()
  scheduledAt.setDate(scheduledAt.getDate() + GRACE_PERIOD_DAYS)

  const row = await deletionRequestsRepository.createDeletionRequest(
    user.publicId,
    user.oauthProvider,
    user.oauthUserId,
    scheduledAt,
    reason,
  )

  logger.info(
    'Deletion request %s created for user %s, scheduled for %s',
    row.id,
    user.publicId,
    scheduledAt.toISOString(),
  )

  return mapRowToDeletionRequest(row)
}

const cancelDeletion = async (
  user: User,
): Promise<DeletionRequest | null> => {
  logger.info('Deletion cancellation requested by user %s', user.publicId)

  const pending = await deletionRequestsRepository.getPendingByUser(
    user.oauthProvider,
    user.oauthUserId,
  )
  if (!pending) {
    logger.warn('No pending deletion request found for user %s', user.publicId)
    return null
  }

  const cancelled = await deletionRequestsRepository.cancelRequest(pending.id)
  if (!cancelled) {
    return null
  }

  logger.info('Deletion request %s cancelled for user %s', pending.id, user.publicId)
  return mapRowToDeletionRequest(cancelled)
}

const getDeletionStatus = async (
  user: User,
): Promise<DeletionRequest | null> => {
  const pending = await deletionRequestsRepository.getPendingByUser(
    user.oauthProvider,
    user.oauthUserId,
  )

  return pending ? mapRowToDeletionRequest(pending) : null
}

const getDueForAnonymisation = async (): Promise<DeletionRequest[]> => {
  const rows = await deletionRequestsRepository.getDueForAnonymisation()
  return rows.map(mapRowToDeletionRequest)
}

const anonymiseUser = async (requestId: string): Promise<void> => {
  const request = await deletionRequestsRepository.getById(requestId)
  if (!request) {
    throw new Error(`Deletion request ${requestId} not found`)
  }

  if (request.status !== DeletionRequestStatus.Processing) {
    throw new Error(
      `Deletion request ${requestId} is in status ${request.status}, expected processing`,
    )
  }

  const hash = hashPublicId(request.user_public_id)
  const anonymisedUsername = `deleted-user-${hash}`

  logger.info('Anonymising auth data for user %s (request %s)', request.user_public_id, requestId)

  // Soft-delete all API keys
  const apiKeys = await apiKeysRepository.getAPIKeysByOAuthUser(
    request.oauth_provider,
    request.oauth_user_id,
  )
  for (const key of apiKeys) {
    await apiKeysRepository.deleteAPIKey(key.id)
  }

  // Remove from organizations
  const memberships = await organizationMembersRepository.getOrganizationMembershipsByUser(
    request.oauth_provider,
    request.oauth_user_id,
  )
  for (const membership of memberships) {
    await organizationMembersRepository.removeMemberFromOrganization(
      membership.organization_id,
      request.oauth_provider,
      request.oauth_user_id,
    )
  }

  // Anonymise user PII fields
  await usersRepository.updateUsername(
    request.oauth_provider,
    request.oauth_user_id,
    anonymisedUsername,
  )
  await usersRepository.updateAvatarUrl(
    request.oauth_provider,
    request.oauth_user_id,
    '',
  )

  logger.info('Auth anonymisation complete for request %s', requestId)
}

const markAsProcessing = async (
  requestId: string,
): Promise<DeletionRequest | null> => {
  const row = await deletionRequestsRepository.updateStatus(
    requestId,
    DeletionRequestStatus.Processing,
    DeletionRequestStatus.Pending,
  )
  return row ? mapRowToDeletionRequest(row) : null
}

const markAsCompleted = async (
  requestId: string,
): Promise<DeletionRequest | null> => {
  const row = await deletionRequestsRepository.updateStatus(
    requestId,
    DeletionRequestStatus.Completed,
    DeletionRequestStatus.Processing,
  )
  return row ? mapRowToDeletionRequest(row) : null
}

const markAsFailed = async (
  requestId: string,
  adminNotes?: string,
): Promise<DeletionRequest | null> => {
  if (adminNotes) {
    await deletionRequestsRepository.updateAdminNotes(requestId, adminNotes)
  }
  const row = await deletionRequestsRepository.updateStatus(
    requestId,
    DeletionRequestStatus.Failed,
    DeletionRequestStatus.Processing,
  )
  return row ? mapRowToDeletionRequest(row) : null
}

const getAllDeletionRequests = async (
  executor: User,
  status?: DeletionRequestStatus,
): Promise<DeletionRequestWithUser[]> => {
  const isAdmin = await UsersUseCases.isAdminUser(executor)
  if (!isAdmin) {
    throw new Error('User does not have admin privileges')
  }

  const rows = status
    ? await deletionRequestsRepository.getAllByStatus(status)
    : await deletionRequestsRepository.getAll()

  return rows.map(mapRowToDeletionRequestWithUser)
}

const updateAdminNotes = async (
  executor: User,
  requestId: string,
  notes: string,
): Promise<DeletionRequest> => {
  const isAdmin = await UsersUseCases.isAdminUser(executor)
  if (!isAdmin) {
    throw new Error('User does not have admin privileges')
  }

  const row = await deletionRequestsRepository.updateAdminNotes(requestId, notes)
  if (!row) {
    throw new Error(`Deletion request ${requestId} not found`)
  }

  return mapRowToDeletionRequest(row)
}

export const DeletionUseCases = {
  requestDeletion,
  cancelDeletion,
  getDeletionStatus,
  getDueForAnonymisation,
  anonymiseUser,
  markAsProcessing,
  markAsCompleted,
  markAsFailed,
  getAllDeletionRequests,
  updateAdminNotes,
}
