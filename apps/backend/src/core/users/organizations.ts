import { v4 } from 'uuid'
import { err, ok, Result } from 'neverthrow'
import {
  Account,
  AccountModel,
  IntentStatus,
  OrganizationMembershipChange,
  OrganizationRole,
  PartnerOrganization,
  User,
  UserRole,
} from '@auto-drive/models'
import { accountsRepository } from '../../infrastructure/repositories/users/accounts.js'
import { intentsRepository } from '../../infrastructure/repositories/users/intents.js'
import { purchasedCreditsRepository } from '../../infrastructure/repositories/users/purchasedCredits.js'
import {
  AuthManager,
  OrganizationRequestError,
} from '../../infrastructure/services/auth/index.js'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../errors/index.js'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('core:organizations')

type OrganizationError = ForbiddenError | OrganizationRequestError

// Intents created before intents.account_id credit the buyer's current
// account when they confirm, and an admin resolves an over-cap one against an
// account by hand. Moving a user with any of these could put credits on the
// wrong account.
const UNRESOLVED_INTENT_STATUSES = [
  IntentStatus.PENDING,
  IntentStatus.CONFIRMED,
  IntentStatus.OVER_CAP,
]

const requireAdmin = (executor: User): Result<void, ForbiddenError> =>
  executor.role === UserRole.Admin
    ? ok()
    : err(new ForbiddenError('User does not have admin privileges'))

const getPartnerAccount = async (
  organizationId: string,
): Promise<Result<Account, NotFoundError>> => {
  const account = await accountsRepository.getByOrganizationId(organizationId)
  return account?.isPartner
    ? ok(account)
    : err(new NotFoundError('Partner organization not found'))
}

const checkNoUnresolvedIntents = async (
  publicId: string,
): Promise<Result<void, ConflictError>> => {
  const intents = await intentsRepository.getByUserAndStatuses(
    publicId,
    UNRESOLVED_INTENT_STATUSES,
  )
  if (intents.length === 0) return ok()

  const statuses = [...new Set(intents.map((i) => i.status))].join(', ')
  return err(
    new ConflictError(
      `User has ${intents.length} unresolved payment(s) (${statuses}). Wait ` +
        'for them to complete or expire, or resolve them, before moving the user.',
    ),
  )
}

/**
 * Creates an organization and its partner account. The account is created
 * here rather than on a member's first request, so members never create it
 * concurrently.
 */
const createPartnerOrganization = async (
  executor: User,
  name: string,
): Promise<Result<PartnerOrganization, OrganizationError>> => {
  const admin = requireAdmin(executor)
  if (admin.isErr()) return err(admin.error)

  const organization = await AuthManager.createOrganization(name)
  if (organization.isErr()) return err(organization.error)

  const account = await accountsRepository.createAccount(
    v4(),
    organization.value.id,
    // Monthly so the download allowance resets. No free uploads: a partner
    // pays for them with purchased credits.
    AccountModel.Monthly,
    0,
    config.params.defaultAccount.downloadLimit,
    executor.publicId,
  )
  logger.info('Partner organization created', {
    organizationId: organization.value.id,
    accountId: account.id,
    by: executor.publicId,
  })

  return ok({
    ...organization.value,
    archivedAt: null,
    memberCount: 0,
    accountId: account.id,
  })
}

const listPartnerOrganizations = async (
  executor: User,
): Promise<Result<PartnerOrganization[], OrganizationError>> => {
  const admin = requireAdmin(executor)
  if (admin.isErr()) return err(admin.error)

  const accounts = await accountsRepository.getPartnerAccounts()
  const accountIdByOrganization = new Map(
    accounts.map((a) => [a.organizationId, a.id]),
  )

  // The auth service answers at most 100 organizations at a time.
  const organizationIds = [...accountIdByOrganization.keys()]
  const partners: PartnerOrganization[] = []
  for (let i = 0; i < organizationIds.length; i += 100) {
    const summaries = await AuthManager.getOrganizationSummaries(
      organizationIds.slice(i, i + 100),
    )
    if (summaries.isErr()) return err(summaries.error)
    for (const summary of summaries.value) {
      partners.push({
        ...summary,
        accountId: accountIdByOrganization.get(summary.id)!,
      })
    }
  }

  return ok(partners)
}

/**
 * Moves a user into a partner organization. Refused while their current
 * account holds purchased credits, which are not transferred, or while they
 * have unresolved payments.
 */
const addMember = async (
  executor: User,
  organizationId: string,
  publicId: string,
  role: OrganizationRole,
): Promise<Result<void, OrganizationError>> => {
  const admin = requireAdmin(executor)
  if (admin.isErr()) return err(admin.error)

  const partnerAccount = await getPartnerAccount(organizationId)
  if (partnerAccount.isErr()) return err(partnerAccount.error)

  const user = await AuthManager.getUserFromPublicId(publicId).catch(
    () => null,
  )
  if (!user?.organizationId) {
    return err(new NotFoundError(`User ${publicId} not found`))
  }
  if (user.organizationId === organizationId) {
    return err(
      new ConflictError('User is already a member of this organization'),
    )
  }

  const currentAccount = await accountsRepository.getByOrganizationId(
    user.organizationId,
  )
  if (currentAccount?.isPartner) {
    return err(
      new ConflictError(
        'User is a member of another partner organization. Remove them from ' +
          'it first.',
      ),
    )
  }
  if (currentAccount) {
    const { uploadBytesRemaining } =
      await purchasedCreditsRepository.getRemainingCredits(currentAccount.id)
    if (uploadBytesRemaining > 0n) {
      return err(
        new ConflictError(
          `User's account still holds ${uploadBytesRemaining} bytes of ` +
            'purchased credits, which are not transferred. Wait for them to ' +
            'be used, or refund them, before moving the user.',
        ),
      )
    }
  }

  const intents = await checkNoUnresolvedIntents(publicId)
  if (intents.isErr()) return err(intents.error)

  const added = await AuthManager.addOrganizationMember(
    organizationId,
    { publicId, role },
    executor.publicId,
  )
  if (added.isErr()) return err(added.error)

  logger.info('User moved into partner organization', {
    organizationId,
    publicId,
    role,
    fromOrganizationId: user.organizationId,
    by: executor.publicId,
  })
  return ok()
}

const changeMemberRole = async (
  executor: User,
  organizationId: string,
  publicId: string,
  role: OrganizationRole,
): Promise<Result<void, OrganizationError>> => {
  const admin = requireAdmin(executor)
  if (admin.isErr()) return err(admin.error)

  const partnerAccount = await getPartnerAccount(organizationId)
  if (partnerAccount.isErr()) return err(partnerAccount.error)

  return AuthManager.changeOrganizationMemberRole(
    organizationId,
    publicId,
    role,
    executor.publicId,
  )
}

/**
 * Removes a user from a partner organization. The auth service returns them
 * to the organization they were moved in from, whose account still holds
 * their earlier usage.
 */
const removeMember = async (
  executor: User,
  organizationId: string,
  publicId: string,
): Promise<Result<{ organizationId: string }, OrganizationError>> => {
  const admin = requireAdmin(executor)
  if (admin.isErr()) return err(admin.error)

  const partnerAccount = await getPartnerAccount(organizationId)
  if (partnerAccount.isErr()) return err(partnerAccount.error)

  const intents = await checkNoUnresolvedIntents(publicId)
  if (intents.isErr()) return err(intents.error)

  const removed = await AuthManager.removeOrganizationMember(
    organizationId,
    publicId,
    executor.publicId,
  )
  if (removed.isOk()) {
    logger.info('User removed from partner organization', {
      organizationId,
      publicId,
      toOrganizationId: removed.value.organizationId,
      by: executor.publicId,
    })
  }
  return removed
}

const getMembershipChanges = async (
  executor: User,
  organizationId: string,
): Promise<Result<OrganizationMembershipChange[], OrganizationError>> => {
  const admin = requireAdmin(executor)
  if (admin.isErr()) return err(admin.error)

  return AuthManager.getOrganizationMembershipChanges(organizationId)
}

export const OrganizationsUseCases = {
  createPartnerOrganization,
  listPartnerOrganizations,
  addMember,
  changeMemberRole,
  removeMember,
  getMembershipChanges,
}
