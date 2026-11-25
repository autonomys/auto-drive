import { v4 } from 'uuid'
import { err, ok, Result } from 'neverthrow'
import {
  Account,
  AccountModel,
  ApiKey,
  CreateApiKeyInput,
  IntentStatus,
  ObjectSummary,
  OrganizationApiKeys,
  OrganizationInvitation,
  OrganizationMembershipChange,
  OrganizationOverview,
  OrganizationRole,
  OrganizationWithMembers,
  PaginatedResult,
  PartnerOrganization,
  ReceivedOrganizationInvitation,
  SERVICE_USER_PROVIDER,
  User,
  UserRole,
  UserWithOrganization,
  deriveUserPublicId,
} from '@auto-drive/models'
import { accountsRepository } from '../../infrastructure/repositories/users/accounts.js'
import { intentsRepository } from '../../infrastructure/repositories/users/intents.js'
import { purchasedCreditsRepository } from '../../infrastructure/repositories/users/purchasedCredits.js'
import { organizationInvitationsRepository } from '../../infrastructure/repositories/users/organizationInvitations.js'
import { AccountsUseCases } from './accounts.js'
import { ObjectUseCases } from '../objects/object.js'
import { OwnershipUseCases } from '../objects/ownership.js'
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

export const getPartnerAccount = async (
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
 * Whether a user may be moved into a partner organization from their current
 * one: not out of another partner organization, not with unresolved payments,
 * and leaving purchased credits behind only when allowed. Returns the bytes
 * left behind.
 */
const checkCanMove = async (
  publicId: string,
  currentOrganizationId: string,
  allowUnusedCredits: boolean,
): Promise<Result<bigint, ConflictError>> => {
  const currentAccount = await accountsRepository.getByOrganizationId(
    currentOrganizationId,
  )
  if (currentAccount?.isPartner) {
    return err(
      new ConflictError(
        'User is a member of another partner organization. Remove them from ' +
          'it first.',
      ),
    )
  }

  // Checked before the credits so nobody is asked to confirm leaving credits
  // behind on a move that would then be refused anyway.
  const intents = await checkNoUnresolvedIntents(publicId)
  if (intents.isErr()) return err(intents.error)

  const unusedCreditBytes = currentAccount
    ? (await purchasedCreditsRepository.getRemainingCredits(currentAccount.id))
        .purchasedUploadBytesRemaining
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
  return ok(unusedCreditBytes)
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

  const user = await AuthManager.getUserFromPublicId(publicId).catch(() => null)
  if (!user?.organizationId) {
    return err(new NotFoundError(`User ${publicId} not found`))
  }
  if (user.organizationId === organizationId) {
    return err(
      new ConflictError('User is already a member of this organization'),
    )
  }

  const movable = await checkCanMove(
    publicId,
    user.organizationId,
    allowUnusedCredits,
  )
  if (movable.isErr()) return err(movable.error)
  const unusedCreditBytes = movable.value

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

const roleOf = (
  organization: OrganizationWithMembers,
  publicId: string,
): OrganizationRole | null =>
  organization.memberships.find((m) => m.publicId === publicId)?.role ?? null

/**
 * Who may manage an organization's members: Auto Drive admins, and the
 * organization's own admins. Signed in only, so an API key can't change who
 * is in the organization.
 */
const authorizeMemberManagement = async (
  executor: UserWithOrganization,
  organizationId: string,
): Promise<
  Result<
    { organization: OrganizationWithMembers; isAutoDriveAdmin: boolean },
    OrganizationError
  >
> => {
  if (executor.apiKeyId) {
    return err(new ForbiddenError('Members can only be managed when signed in'))
  }
  const isAutoDriveAdmin = executor.role === UserRole.Admin
  if (!isAutoDriveAdmin && executor.organizationId !== organizationId) {
    return err(new ForbiddenError('Not a member of this organization'))
  }

  const partnerAccount = await getPartnerAccount(organizationId)
  if (partnerAccount.isErr()) return err(partnerAccount.error)

  const organization = await AuthManager.getOrganization(organizationId)
  if (organization.isErr()) return err(organization.error)
  if (
    !isAutoDriveAdmin &&
    roleOf(organization.value, executor.publicId) !== OrganizationRole.Admin
  ) {
    return err(
      new ForbiddenError('Only organization admins can manage its members'),
    )
  }
  return ok({ organization: organization.value, isAutoDriveAdmin })
}

/**
 * An organization's own admins can't leave it without one: the last admin
 * can't be demoted or removed. Auto Drive admins can, and can appoint another.
 */
const keepsAnAdmin = (
  organization: OrganizationWithMembers,
  publicId: string,
  newRole: OrganizationRole | null,
): Result<void, ConflictError> => {
  if (
    roleOf(organization, publicId) !== OrganizationRole.Admin ||
    newRole === OrganizationRole.Admin
  ) {
    return ok()
  }
  const admins = organization.memberships.filter(
    (m) => m.role === OrganizationRole.Admin,
  )
  return admins.length > 1
    ? ok()
    : err(
        new ConflictError(
          'An organization needs at least one admin. Make another member an ' +
            'admin first.',
        ),
      )
}

const changeMemberRole = async (
  executor: UserWithOrganization,
  organizationId: string,
  publicId: string,
  role: OrganizationRole,
): Promise<Result<void, OrganizationError>> => {
  const allowed = await authorizeMemberManagement(executor, organizationId)
  if (allowed.isErr()) return err(allowed.error)
  const { organization, isAutoDriveAdmin } = allowed.value

  if (!isAutoDriveAdmin) {
    const kept = keepsAnAdmin(organization, publicId, role)
    if (kept.isErr()) return err(kept.error)
  }

  const changed = await AuthManager.changeOrganizationMemberRole(
    organizationId,
    publicId,
    role,
    executor.publicId,
  )
  if (changed.isOk()) {
    logger.info('Partner organization member role changed', {
      organizationId,
      publicId,
      role,
      by: executor.publicId,
    })
  }
  return changed
}

/**
 * Removes a user from a partner organization. The auth service returns them
 * to the organization they were moved in from, whose account still holds
 * their earlier usage.
 */
const removeMember = async (
  executor: UserWithOrganization,
  organizationId: string,
  publicId: string,
): Promise<Result<{ organizationId: string }, OrganizationError>> => {
  const allowed = await authorizeMemberManagement(executor, organizationId)
  if (allowed.isErr()) return err(allowed.error)
  const { organization, isAutoDriveAdmin } = allowed.value

  if (!isAutoDriveAdmin) {
    const kept = keepsAnAdmin(organization, publicId, null)
    if (kept.isErr()) return err(kept.error)
  }

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

// Long enough to reach someone on holiday, short enough that a forgotten one
// lapses.
const INVITATION_DAYS = 14
// Bounds how many users one organization can put a banner in front of.
const MAX_PENDING_INVITATIONS = 50

/**
 * Invites a user into a partner organization. Nobody joins without accepting,
 * since joining moves their uploads onto the organization's account and shows
 * their name to its members. Inviting a user again renews their invitation.
 */
const inviteMember = async (
  executor: UserWithOrganization,
  organizationId: string,
  publicId: string,
  role: OrganizationRole,
): Promise<Result<OrganizationInvitation, OrganizationError>> => {
  const allowed = await authorizeMemberManagement(executor, organizationId)
  if (allowed.isErr()) return err(allowed.error)
  const { organization } = allowed.value

  if (organization.archivedAt) {
    return err(new ConflictError('Organization is archived'))
  }
  if (roleOf(organization, publicId)) {
    return err(
      new ConflictError('User is already a member of this organization'),
    )
  }
  const user = await AuthManager.getUserFromPublicId(publicId).catch(() => null)
  if (!user?.organizationId || user.oauthProvider === SERVICE_USER_PROVIDER) {
    return err(new NotFoundError(`User ${publicId} not found`))
  }
  // In the organization but not among its members: a partner end user, who
  // can't become a member.
  if (user.organizationId === organizationId) {
    return err(new ConflictError('User is already in this organization'))
  }
  const pending =
    await organizationInvitationsRepository.countPendingByOrganization(
      organizationId,
      publicId,
    )
  if (pending >= MAX_PENDING_INVITATIONS) {
    return err(
      new ConflictError(
        `At most ${MAX_PENDING_INVITATIONS} invitations can be pending. ` +
          'Revoke some first.',
      ),
    )
  }

  const invitation = await organizationInvitationsRepository.upsertOpen({
    id: v4(),
    organizationId,
    publicId,
    role,
    invitedBy: executor.publicId,
    expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
  })
  logger.info('User invited into partner organization', {
    organizationId,
    invitationId: invitation.id,
    publicId,
    role,
    by: executor.publicId,
  })
  return ok(invitation)
}

const getInvitations = async (
  executor: UserWithOrganization,
  organizationId: string,
): Promise<Result<OrganizationInvitation[], OrganizationError>> => {
  const allowed = await authorizeMemberManagement(executor, organizationId)
  if (allowed.isErr()) return err(allowed.error)

  return ok(
    await organizationInvitationsRepository.getPendingByOrganization(
      organizationId,
    ),
  )
}

const revokeInvitation = async (
  executor: UserWithOrganization,
  organizationId: string,
  invitationId: string,
): Promise<Result<void, OrganizationError>> => {
  const allowed = await authorizeMemberManagement(executor, organizationId)
  if (allowed.isErr()) return err(allowed.error)

  const invitation =
    await organizationInvitationsRepository.getPendingById(invitationId)
  if (invitation?.organizationId !== organizationId) {
    return err(new NotFoundError('Invitation not found'))
  }
  await organizationInvitationsRepository.revoke(
    invitationId,
    executor.publicId,
  )
  logger.info('Partner organization invitation revoked', {
    organizationId,
    invitationId,
    by: executor.publicId,
  })
  return ok()
}

/**
 * The caller's invitations, with the organization's name. Who sent each is
 * left out: the invitee is not a member, and sign-in names are private.
 */
const getReceivedInvitations = async (
  executor: UserWithOrganization,
): Promise<Result<ReceivedOrganizationInvitation[], OrganizationError>> => {
  // One to the caller's own organization is moot: they were added directly
  // while it was open.
  const invitations = (
    await organizationInvitationsRepository.getPendingByPublicId(
      executor.publicId,
    )
  ).filter((i) => i.organizationId !== executor.organizationId)
  if (invitations.length === 0) return ok([])

  const organizations = await AuthManager.getOrganizationSummaries([
    ...new Set(invitations.map((i) => i.organizationId)),
  ])
  if (organizations.isErr()) return err(organizations.error)

  // An archived organization can't be joined, so its invitations are left out.
  const organizationNames = new Map(
    organizations.value.filter((o) => !o.archivedAt).map((o) => [o.id, o.name]),
  )
  return ok(
    invitations.flatMap((invitation) => {
      const organizationName = organizationNames.get(invitation.organizationId)
      if (!organizationName) return []
      return [
        {
          id: invitation.id,
          organizationId: invitation.organizationId,
          organizationName,
          role: invitation.role,
          createdAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
        },
      ]
    }),
  )
}

const getOwnPendingInvitation = async (
  executor: UserWithOrganization,
  invitationId: string,
  action: string,
): Promise<Result<OrganizationInvitation, OrganizationError>> => {
  if (executor.apiKeyId) {
    return err(
      new ForbiddenError(`Invitations can only be ${action} when signed in`),
    )
  }
  const invitation =
    await organizationInvitationsRepository.getPendingById(invitationId)
  if (invitation?.publicId !== executor.publicId) {
    return err(new NotFoundError('Invitation not found'))
  }
  return ok(invitation)
}

/**
 * Joins the organization the caller was invited into, with the checks an
 * Auto Drive admin's move makes. The caller confirms leaving purchased
 * credits behind themselves, with `allowUnusedCredits`. The membership change
 * is recorded as made by whoever sent the invitation.
 */
const acceptInvitation = async (
  executor: UserWithOrganization,
  invitationId: string,
  { allowUnusedCredits = false }: { allowUnusedCredits?: boolean } = {},
): Promise<Result<{ organizationId: string }, OrganizationError>> => {
  const found = await getOwnPendingInvitation(
    executor,
    invitationId,
    'accepted',
  )
  if (found.isErr()) return err(found.error)
  const invitation = found.value
  const { organizationId } = invitation

  const [partnerAccount, organization] = await Promise.all([
    getPartnerAccount(organizationId),
    AuthManager.getOrganization(organizationId),
  ])
  if (partnerAccount.isErr()) return err(partnerAccount.error)
  if (organization.isErr()) return err(organization.error)
  // Auth refuses the move too; checked here so the user isn't first asked to
  // confirm leaving credits behind for a move that can't happen.
  if (organization.value.archivedAt) {
    return err(new ConflictError('This organization no longer exists'))
  }
  // The invitation acts with its sender's authority, so it lapses once they
  // can no longer manage the organization's members. A failed lookup throws
  // and fails the request, leaving the invitation to be retried.
  const sender = invitation.invitedBy
  if (
    roleOf(organization.value, sender) !== OrganizationRole.Admin &&
    (await AuthManager.getUserFromPublicId(sender)).role !== UserRole.Admin
  ) {
    await organizationInvitationsRepository.revoke(invitationId, null)
    return err(
      new ConflictError(
        'This invitation is no longer valid. Ask the organization for a new one.',
      ),
    )
  }

  if (!executor.organizationId) {
    return err(
      new ForbiddenError('Finish signing up before joining an organization'),
    )
  }
  if (executor.organizationId !== organizationId) {
    const movable = await checkCanMove(
      executor.publicId,
      executor.organizationId,
      allowUnusedCredits,
    )
    if (movable.isErr()) return err(movable.error)

    const added = await AuthManager.addOrganizationMember(
      organizationId,
      { publicId: executor.publicId, role: invitation.role },
      invitation.invitedBy,
    )
    if (added.isErr()) return err(added.error)

    logger.info('User joined partner organization by invitation', {
      organizationId,
      invitationId,
      publicId: executor.publicId,
      role: invitation.role,
      fromOrganizationId: executor.organizationId,
      unusedCreditBytes: movable.value.toString(),
      invitedBy: invitation.invitedBy,
    })
  }
  await organizationInvitationsRepository.markAccepted(invitationId)
  return ok({ organizationId })
}

const declineInvitation = async (
  executor: UserWithOrganization,
  invitationId: string,
): Promise<Result<void, OrganizationError>> => {
  const found = await getOwnPendingInvitation(
    executor,
    invitationId,
    'declined',
  )
  if (found.isErr()) return err(found.error)

  await organizationInvitationsRepository.markDeclined(invitationId)
  return ok()
}

/**
 * Members read their organization, and Auto Drive admins any partner
 * organization.
 */
const authorizeMember = (
  executor: UserWithOrganization,
  organizationId: string,
): Result<void, ForbiddenError> =>
  executor.organizationId === organizationId || executor.role === UserRole.Admin
    ? ok()
    : err(new ForbiddenError('Not a member of this organization'))

/** A partner organization as its members see it. */
const getOverview = async (
  executor: UserWithOrganization,
  organizationId: string,
): Promise<Result<OrganizationOverview, OrganizationError>> => {
  const member = authorizeMember(executor, organizationId)
  if (member.isErr()) return err(member.error)

  const partnerAccount = await getPartnerAccount(organizationId)
  if (partnerAccount.isErr()) return err(partnerAccount.error)
  const account = partnerAccount.value

  const organization = await AuthManager.getOrganization(organizationId)
  if (organization.isErr()) return err(organization.error)

  // Issues this month's free credits, so the balance below includes them.
  await AccountsUseCases.ensureMonthlyFreeCredits(account)
  const remaining = await purchasedCreditsRepository.getRemainingCredits(
    account.id,
  )
  const terms = AccountsUseCases.getCreditTerms(account)

  const viewerRole = roleOf(organization.value, executor.publicId)
  const isAutoDriveAdmin = executor.role === UserRole.Admin
  return ok({
    id: organization.value.id,
    name: organization.value.name,
    accountId: account.id,
    viewerRole,
    // Matches authorizeMemberManagement, which refuses API keys.
    canManageMembers:
      !executor.apiKeyId &&
      (isAutoDriveAdmin || viewerRole === OrganizationRole.Admin),
    // Public IDs only, never sign-in names (emails for Google accounts).
    members: organization.value.memberships.map(({ publicId, role }) => ({
      publicId,
      role,
    })),
    credits: {
      purchasedBytesRemaining:
        remaining.purchasedUploadBytesRemaining.toString(),
      purchasedNextExpiry:
        remaining.purchasedNextExpiryDate?.toISOString() ?? null,
      freeCreditBytesRemaining: remaining.freeUploadBytesRemaining.toString(),
      monthlyFreeUploadBytes: account.monthlyFreeUploadBytes.toString(),
      maxPurchasedBytes: terms.maxBytes.toString(),
      creditExpiryDays: terms.expiryDays,
    },
    maxEndUserQuotaBytes: account.maxEndUserQuotaBytes.toString(),
  })
}

/**
 * Files uploaded with the organization's API keys, newest first. Its service
 * user owns them, so they are in no member's drive.
 */
const getFiles = async (
  executor: UserWithOrganization,
  organizationId: string,
  limit: number,
  offset: number,
): Promise<Result<PaginatedResult<ObjectSummary>, OrganizationError>> => {
  const member = authorizeMember(executor, organizationId)
  if (member.isErr()) return err(member.error)

  const partnerAccount = await getPartnerAccount(organizationId)
  if (partnerAccount.isErr()) return err(partnerAccount.error)

  const serviceUser = {
    oauthProvider: SERVICE_USER_PROVIDER,
    oauthUserId: organizationId,
    publicId: deriveUserPublicId(SERVICE_USER_PROVIDER, organizationId),
    role: UserRole.User,
  } as User
  const files = await ObjectUseCases.getRootObjects(
    { scope: 'user', user: serviceUser },
    limit,
    offset,
  )
  return ok({
    totalCount: files.totalCount,
    rows: await Promise.all(
      files.rows.map((row) =>
        OwnershipUseCases.withVisibleOwners(row, row.headCid, executor),
      ),
    ),
  })
}

// Organization admins see who was moved in or out, and by whom, as Auto Drive
// admins do.
const getMembershipChanges = async (
  executor: UserWithOrganization,
  organizationId: string,
): Promise<Result<OrganizationMembershipChange[], OrganizationError>> => {
  const allowed = await authorizeMemberManagement(executor, organizationId)
  if (allowed.isErr()) return err(allowed.error)

  return AuthManager.getOrganizationMembershipChanges(organizationId)
}

/**
 * Organisation API keys belong to the organisation's service user in auth, so
 * they keep working whoever leaves. Members see them and organisation admins
 * create and revoke them. Auto Drive admins see and revoke them but can't
 * create one, which would hand them a partner's secret. Never with an API key,
 * so a key can't mint or revoke keys.
 *
 * Returns what the caller may do, which the list passes on to the UI.
 */
const authorizeApiKeys = async (
  executor: UserWithOrganization,
  organizationId: string,
  action: 'list' | 'create' | 'revoke',
): Promise<Result<Omit<OrganizationApiKeys, 'apiKeys'>, OrganizationError>> => {
  if (executor.apiKeyId) {
    return err(
      new ForbiddenError(
        'Organization API keys can only be managed when signed in',
      ),
    )
  }
  const isMember = executor.organizationId === organizationId
  const isAutoDriveAdmin = executor.role === UserRole.Admin
  if (!isMember && !(isAutoDriveAdmin && action !== 'create')) {
    return err(new ForbiddenError('Not a member of this organization'))
  }

  const [partnerAccount, organization] = await Promise.all([
    getPartnerAccount(organizationId),
    isMember ? AuthManager.getOrganization(organizationId) : null,
  ])
  if (partnerAccount.isErr()) return err(partnerAccount.error)
  let isOrganizationAdmin = false
  if (organization) {
    if (organization.isErr()) return err(organization.error)
    isOrganizationAdmin = organization.value.memberships.some(
      (m) =>
        m.publicId === executor.publicId && m.role === OrganizationRole.Admin,
    )
  }

  const permissions = {
    canCreate: isOrganizationAdmin,
    canRevoke: isOrganizationAdmin || isAutoDriveAdmin,
  }
  if (
    (action === 'create' && !permissions.canCreate) ||
    (action === 'revoke' && !permissions.canRevoke)
  ) {
    return err(
      new ForbiddenError('Only organization admins can manage its API keys'),
    )
  }
  return ok(permissions)
}

/** The keys, and whether the caller may create and revoke them. */
const listApiKeys = async (
  executor: UserWithOrganization,
  organizationId: string,
): Promise<Result<OrganizationApiKeys, OrganizationError>> => {
  const allowed = await authorizeApiKeys(executor, organizationId, 'list')
  if (allowed.isErr()) return err(allowed.error)

  const apiKeys = await AuthManager.getOrganizationApiKeys(organizationId)
  if (apiKeys.isErr()) return err(apiKeys.error)
  return ok({ apiKeys: apiKeys.value, ...allowed.value })
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
      scopes: created.value.scopes,
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
  inviteMember,
  getInvitations,
  revokeInvitation,
  getReceivedInvitations,
  acceptInvitation,
  declineInvitation,
  getOverview,
  getFiles,
  getMembershipChanges,
  listApiKeys,
  createApiKey,
  revokeApiKey,
}
