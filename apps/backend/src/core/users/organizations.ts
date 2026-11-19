import { v4 } from 'uuid'
import { err, ok, Result } from 'neverthrow'
import {
  Account,
  AccountModel,
  ApiKey,
  ApiKeyWithoutSecret,
  CreateApiKeyInput,
  IntentStatus,
  OrganizationMembershipChange,
  OrganizationRole,
  PartnerOrganization,
  User,
  UserRole,
  UserWithOrganization,
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
  UnusedCreditsError,
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
 * concurrently. Auth creates the organization's service user with it.
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
 * Moves a user into a partner organization. Refused while they have
 * unresolved payments. Purchased credits on their current account are not
 * transferred, so a move that would leave some behind needs
 * `allowUnusedCredits`. Those credits stay on that account, keep their expiry,
 * and are usable again if the user is removed from the partner organization.
 */
const addMember = async (
  executor: User,
  organizationId: string,
  publicId: string,
  role: OrganizationRole,
  { allowUnusedCredits = false }: { allowUnusedCredits?: boolean } = {},
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

  // Checked before the credits so an admin is not asked to confirm leaving
  // credits behind on a move that would then be refused anyway.
  const intents = await checkNoUnresolvedIntents(publicId)
  if (intents.isErr()) return err(intents.error)

  const unusedCreditBytes = currentAccount
    ? (await purchasedCreditsRepository.getRemainingCredits(currentAccount.id))
        .uploadBytesRemaining
    : 0n
  if (unusedCreditBytes > 0n && !allowUnusedCredits) {
    return err(
      new UnusedCreditsError(
        `User's account still holds ${unusedCreditBytes} bytes of purchased ` +
          'credits, which are not transferred. They stay on that account ' +
          'and keep expiring on schedule, unusable until the user is ' +
          'removed from the partner organization.',
      ),
    )
  }

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
    unusedCreditBytes: unusedCreditBytes.toString(),
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

/**
 * Organisation API keys belong to the organisation's service user in auth, so
 * they keep working whoever leaves. Members see them and organisation admins
 * create and revoke them. Auto Drive admins see and revoke them but can't
 * create one, which would hand them a partner's secret. Never with an API key,
 * so a key can't mint or revoke keys.
 */
const authorizeApiKeys = async (
  executor: UserWithOrganization,
  organizationId: string,
  action: 'list' | 'create' | 'revoke',
): Promise<Result<void, OrganizationError>> => {
  if (executor.apiKeyId) {
    return err(
      new ForbiddenError(
        'Organization API keys can only be managed when signed in',
      ),
    )
  }
  const asAutoDriveAdmin =
    executor.role === UserRole.Admin && action !== 'create'
  if (!asAutoDriveAdmin && executor.organizationId !== organizationId) {
    return err(new ForbiddenError('Not a member of this organization'))
  }

  const needsOrganizationAdmin = action !== 'list' && !asAutoDriveAdmin
  const [partnerAccount, organization] = await Promise.all([
    getPartnerAccount(organizationId),
    needsOrganizationAdmin ? AuthManager.getOrganization(organizationId) : null,
  ])
  if (partnerAccount.isErr()) return err(partnerAccount.error)
  if (!organization) return ok()
  if (organization.isErr()) return err(organization.error)
  const isOrganizationAdmin = organization.value.memberships.some(
    (m) =>
      m.publicId === executor.publicId && m.role === OrganizationRole.Admin,
  )
  return isOrganizationAdmin
    ? ok()
    : err(
        new ForbiddenError('Only organization admins can manage its API keys'),
      )
}

const listApiKeys = async (
  executor: UserWithOrganization,
  organizationId: string,
): Promise<Result<ApiKeyWithoutSecret[], OrganizationError>> => {
  const allowed = await authorizeApiKeys(executor, organizationId, 'list')
  if (allowed.isErr()) return err(allowed.error)

  return AuthManager.getOrganizationApiKeys(organizationId)
}

/** Returns the key with its secret, which is never shown again. */
const createApiKey = async (
  executor: UserWithOrganization,
  organizationId: string,
  input: CreateApiKeyInput,
): Promise<Result<ApiKey, OrganizationError>> => {
  const allowed = await authorizeApiKeys(executor, organizationId, 'create')
  if (allowed.isErr()) return err(allowed.error)

  const created = await AuthManager.createOrganizationApiKey(
    organizationId,
    input,
  )
  if (created.isOk()) {
    logger.info('Organization API key created', {
      organizationId,
      apiKeyId: created.value.id,
      by: executor.publicId,
    })
  }
  return created
}

const revokeApiKey = async (
  executor: UserWithOrganization,
  organizationId: string,
  apiKeyId: string,
): Promise<Result<void, OrganizationError>> => {
  const allowed = await authorizeApiKeys(executor, organizationId, 'revoke')
  if (allowed.isErr()) return err(allowed.error)

  const revoked = await AuthManager.revokeOrganizationApiKey(
    organizationId,
    apiKeyId,
  )
  if (revoked.isOk()) {
    logger.info('Organization API key revoked', {
      organizationId,
      apiKeyId,
      by: executor.publicId,
    })
  }
  return revoked
}

export const OrganizationsUseCases = {
  createPartnerOrganization,
  listPartnerOrganizations,
  addMember,
  changeMemberRole,
  removeMember,
  getMembershipChanges,
  listApiKeys,
  createApiKey,
  revokeApiKey,
}
