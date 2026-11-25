import pg from 'pg'
import { v4 } from 'uuid'
import { getAddress } from 'ethers'
import {
  MEMBER_ROLES,
  User,
  ApiKey,
  ApiKeyScope,
  ApiKeyWithoutSecret,
  EndUserChange,
  Organization,
  OrganizationMembershipChange,
  OrganizationRole,
  OrganizationSummary,
  OrganizationWithMembers,
  PartnerEndUser,
  SERVICE_USER_PROVIDER,
  UserRole,
  userFromTable,
} from '@auto-drive/models'
import {
  DBOrganizationMember,
  apiKeysRepository,
  organizationMembersRepository,
  organizationMembershipChangesRepository,
  organizationRole,
  organizationsRepository,
  uploadQuotaBytes,
  usersRepository,
} from '../repositories/index.js'
import { deriveUserPublicId } from './users.js'
import { ApiKeysUseCases } from './apikeys.js'
import { withTransaction } from '../drivers/pg.js'
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
  OrganizationValidationError,
} from '../errors/organizations.js'
import { ApiKeyNotFoundError } from '../errors/apikeys.js'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('useCases:organizations')

// The user's organisation, when it was archived, and their membership of it.
const getMembershipByUser = async (
  user: User,
): Promise<{
  organization: Organization
  archivedAt: Date | null
  membership: DBOrganizationMember
}> => {
  const membership =
    await organizationMembersRepository.getOrganizationMembershipByUser(
      user.oauthProvider,
      user.oauthUserId,
    )

  if (!membership) {
    throw new Error(
      `User is not a member of any organization: (${user.oauthProvider}, ${user.oauthUserId})`,
    )
  }

  const organization = await organizationsRepository.getOrganizationById(
    membership.organization_id,
  )

  if (!organization) {
    throw new Error('Organization not found')
  }

  return {
    organization: { id: organization.id, name: organization.name },
    archivedAt: organization.archived_at,
    membership,
  }
}

const getOrganizationByUser = async (user: User): Promise<Organization> =>
  (await getMembershipByUser(user)).organization

// Removed or not.
const isPartnerEndUser = async (user: User): Promise<boolean> => {
  const membership =
    await organizationMembersRepository.getOrganizationMembershipByUser(
      user.oauthProvider,
      user.oauthUserId,
    )
  return membership?.role === OrganizationRole.PartnerEndUser
}

// Every user starts in a personal organisation of their own. Its name is not
// shown anywhere, so it carries no identifier of the user.
const initOrganization = async (user: User, db: pg.Client) => {
  await createPersonalOrganization(user.oauthProvider, user.oauthUserId, db)
}

const createPersonalOrganization = async (
  oauthProvider: string,
  oauthUserId: string,
  db: pg.Client,
): Promise<string> => {
  const organization = await organizationsRepository.createOrganization(
    v4(),
    'Personal',
    db,
  )
  await organizationMembersRepository.addMemberToOrganization(
    organization.id,
    oauthProvider,
    oauthUserId,
    OrganizationRole.Admin,
    db,
  )
  return organization.id
}

const getOrganization = async (
  organizationId: string,
): Promise<OrganizationWithMembers> => {
  const organization =
    await organizationsRepository.getOrganizationById(organizationId)

  if (!organization) {
    throw new OrganizationNotFoundError('Organization not found')
  }

  const memberships = (
    await organizationMembersRepository.getOrganizationMemberships(
      organizationId,
    )
  ).map((member) => ({
    publicId: deriveUserPublicId(member.oauth_provider, member.oauth_user_id),
    role: organizationRole(member),
  }))

  return {
    id: organization.id,
    name: organization.name,
    archivedAt: organization.archived_at?.toISOString() ?? null,
    // Kept as public IDs: a backend from before roles compares them as
    // strings, so changing them would break it during a deploy or rollback.
    members: memberships.map((member) => member.publicId),
    memberships,
  }
}

// A partner organisation's service user owns its API keys, so they keep
// working whoever leaves. It is identified by the organisation.
const serviceUserOf = (organizationId: string): User =>
  userFromTable({
    oauthProvider: SERVICE_USER_PROVIDER,
    oauthUserId: organizationId,
    publicId: deriveUserPublicId(SERVICE_USER_PROVIDER, organizationId),
    role: UserRole.User,
  })

const createServiceUser = async (organizationId: string, db: pg.Client) => {
  const user = serviceUserOf(organizationId)
  await usersRepository.createUser(
    user.oauthProvider,
    user.oauthUserId,
    undefined,
    undefined,
    user.publicId,
    user.role,
    db,
  )
  await organizationMembersRepository.addMemberToOrganization(
    organizationId,
    user.oauthProvider,
    user.oauthUserId,
    OrganizationRole.Member,
    db,
  )
}

// Only the backend creates organisations, each for a partner.
const createOrganization = async (name: string): Promise<Organization> => {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 100) {
    throw new OrganizationValidationError(
      'Organization name must be 1 to 100 characters',
    )
  }

  return withTransaction(async (db) => {
    const organization = await organizationsRepository.createOrganization(
      v4(),
      trimmed,
      db,
    )
    await createServiceUser(organization.id, db)
    return { id: organization.id, name: organization.name }
  })
}

const listApiKeys = (organizationId: string): Promise<ApiKeyWithoutSecret[]> =>
  ApiKeysUseCases.getApiKeysByUser(serviceUserOf(organizationId))

const createApiKey = async (
  organizationId: string,
  options: {
    name: string | null
    expiresAt: Date | null
    scopes?: ApiKeyScope[] | null
  },
): Promise<ApiKey> => {
  const organization =
    await organizationsRepository.getOrganizationById(organizationId)
  if (!organization) {
    throw new OrganizationNotFoundError('Organization not found')
  }
  if (organization.archived_at) {
    throw new OrganizationConflictError('Organization is archived')
  }

  // Partners created before service users get theirs with their first key.
  const serviceUser = serviceUserOf(organizationId)
  const serviceUserExists = () =>
    usersRepository.getUserByOAuthInformation(
      serviceUser.oauthProvider,
      serviceUser.oauthUserId,
    )
  if (!(await serviceUserExists())) {
    try {
      await withTransaction((db) => createServiceUser(organizationId, db))
    } catch (error) {
      // A concurrent first key may have created it.
      if (!(await serviceUserExists())) throw error
    }
  }

  return ApiKeysUseCases.createApiKey(serviceUser, options)
}

const revokeApiKey = async (
  organizationId: string,
  apiKeyId: string,
): Promise<void> => {
  const apiKey = await apiKeysRepository.getApiKeyById(apiKeyId)
  // Any other key, a member's own included, is not this organisation's.
  if (
    apiKey?.oauthProvider !== SERVICE_USER_PROVIDER ||
    apiKey.oauthUserId !== organizationId
  ) {
    throw new ApiKeyNotFoundError()
  }

  await apiKeysRepository.deleteApiKey(apiKeyId)
}

const getOrganizationSummaries = async (
  ids: string[],
): Promise<OrganizationSummary[]> => {
  const rows = await organizationsRepository.getOrganizationSummaries(ids)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    archivedAt: row.archived_at?.toISOString() ?? null,
    memberCount: Number(row.member_count),
  }))
}

// Partner end users are only ever enrolled (enrollEndUsers), never given the
// role.
const parseRole = (role: unknown): OrganizationRole => {
  if (!MEMBER_ROLES.includes(role as (typeof MEMBER_ROLES)[number])) {
    throw new OrganizationValidationError(
      `Role must be one of: ${MEMBER_ROLES.join(', ')}`,
    )
  }
  return role as OrganizationRole
}

const getMemberUser = async (publicId: string) => {
  const user = await usersRepository.getUserByPublicId(publicId)
  if (!user) {
    throw new OrganizationNotFoundError(`User ${publicId} not found`)
  }
  // It holds its organisation's API keys, so it stays there as it is.
  if (user.oauth_provider === SERVICE_USER_PROVIDER) {
    throw new OrganizationConflictError(
      'A service user cannot be moved or have its role changed',
    )
  }
  return user
}

// End users are enrolled and removed by their organisation only.
const endUserConflict = () =>
  new OrganizationConflictError(
    'An end user cannot be moved or have its role changed',
  )

/**
 * Moves a user into an organisation. They leave their current organisation,
 * which is archived if nobody is left in it, so the user keeps exactly one
 * membership. Preconditions on the user's credits and payments are checked by
 * the backend, which is the only caller.
 */
const addMember = async ({
  organizationId,
  publicId,
  role,
  actor,
}: {
  organizationId: string
  publicId: string
  role: unknown
  actor: string
}): Promise<void> => {
  const memberRole = parseRole(role)
  const user = await getMemberUser(publicId)
  const organization =
    await organizationsRepository.getOrganizationById(organizationId)
  if (!organization) {
    throw new OrganizationNotFoundError('Organization not found')
  }
  if (organization.archived_at) {
    throw new OrganizationConflictError('Organization is archived')
  }

  await withTransaction(async (db) => {
    const [from] = await organizationMembersRepository.removeUserMemberships(
      user.oauth_provider,
      user.oauth_user_id,
      db,
    )
    if (from?.role === OrganizationRole.PartnerEndUser) {
      throw endUserConflict()
    }
    const fromOrganizationId = from?.organization_id ?? null
    if (fromOrganizationId === organizationId) {
      throw new OrganizationConflictError(
        'User is already a member of this organization',
      )
    }
    if (fromOrganizationId) {
      await organizationsRepository.archiveIfEmpty(fromOrganizationId, db)
    }

    await organizationMembersRepository.addMemberToOrganization(
      organizationId,
      user.oauth_provider,
      user.oauth_user_id,
      memberRole,
      db,
    )
    await organizationMembershipChangesRepository.recordChange(
      {
        oauthProvider: user.oauth_provider,
        oauthUserId: user.oauth_user_id,
        fromOrganizationId,
        toOrganizationId: organizationId,
        role: memberRole,
        actor,
      },
      db,
    )
  })
}

const changeMemberRole = async ({
  organizationId,
  publicId,
  role,
  actor,
}: {
  organizationId: string
  publicId: string
  role: unknown
  actor: string
}): Promise<void> => {
  const memberRole = parseRole(role)
  const user = await getMemberUser(publicId)
  // A user becomes an end user only when enrolment creates them, and stays
  // one, removed or not, so this cannot change before the update.
  const current =
    await organizationMembersRepository.getOrganizationMembershipByUser(
      user.oauth_provider,
      user.oauth_user_id,
    )
  if (current?.role === OrganizationRole.PartnerEndUser) {
    throw endUserConflict()
  }

  await withTransaction(async (db) => {
    const membership = await organizationMembersRepository.updateMemberRole(
      organizationId,
      user.oauth_provider,
      user.oauth_user_id,
      memberRole,
      db,
    )
    if (!membership) {
      throw new OrganizationNotFoundError(
        'User is not a member of this organization',
      )
    }

    await organizationMembershipChangesRepository.recordChange(
      {
        oauthProvider: user.oauth_provider,
        oauthUserId: user.oauth_user_id,
        fromOrganizationId: organizationId,
        toOrganizationId: organizationId,
        role: memberRole,
        actor,
      },
      db,
    )
  })
}

/**
 * Removes a user from an organisation and returns them to the organisation
 * they were moved in from, restoring it from the archive. If there is none to
 * restore, they get a new personal organisation, so a user is never left
 * without one. Partner end users are removed only by removeEndUser.
 */
const removeMember = async ({
  organizationId,
  publicId,
  actor,
}: {
  organizationId: string
  publicId: string
  actor: string
}): Promise<{ organizationId: string }> => {
  const user = await getMemberUser(publicId)

  return withTransaction(async (db) => {
    const removed =
      await organizationMembersRepository.removeMemberFromOrganization(
        organizationId,
        user.oauth_provider,
        user.oauth_user_id,
        db,
      )
    if (!removed) {
      throw new OrganizationNotFoundError(
        'User is not a member of this organization',
      )
    }
    // Rolled back with the transaction.
    if (removed.role === OrganizationRole.PartnerEndUser) {
      throw new OrganizationConflictError(
        'An end user is removed through the end users endpoint',
      )
    }

    const moveIn = await organizationMembershipChangesRepository.getLatestMoveInto(
      organizationId,
      user.oauth_provider,
      user.oauth_user_id,
      db,
    )
    const restored = moveIn?.from_organization_id
      ? await organizationsRepository.unarchive(moveIn.from_organization_id, db)
      : null

    let restoredOrganizationId: string
    if (restored) {
      await organizationMembersRepository.addMemberToOrganization(
        restored.id,
        user.oauth_provider,
        user.oauth_user_id,
        OrganizationRole.Admin,
        db,
      )
      restoredOrganizationId = restored.id
    } else {
      restoredOrganizationId = await createPersonalOrganization(
        user.oauth_provider,
        user.oauth_user_id,
        db,
      )
    }

    await organizationMembershipChangesRepository.recordChange(
      {
        oauthProvider: user.oauth_provider,
        oauthUserId: user.oauth_user_id,
        fromOrganizationId: organizationId,
        toOrganizationId: restoredOrganizationId,
        role: OrganizationRole.Admin,
        actor,
      },
      db,
    )

    return { organizationId: restoredOrganizationId }
  })
}

// Wallet sign-in (providers/web3.ts) identifies a user by their address in
// EIP-55 form, so end users are stored under it.
const WALLET_PROVIDER = 'web3-wallet'

// The address in EIP-55 form. Mixed case must be a valid checksum.
const parseAddress = (address: string): string => {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) {
    try {
      return getAddress(address)
    } catch {
      // A bad checksum.
    }
  }
  throw new OrganizationValidationError(`Invalid address: ${address}`)
}

export type EndUserEnrollment = {
  address: string
  customerReference: string
  // Null for the account's default.
  uploadQuotaBytes: number | null
}

const toPartnerEndUser = (
  membership: DBOrganizationMember,
): PartnerEndUser => ({
  address: membership.oauth_user_id,
  publicId: deriveUserPublicId(
    membership.oauth_provider,
    membership.oauth_user_id,
  ),
  // Every end user is enrolled with one.
  customerReference: membership.customer_reference as string,
  uploadQuotaBytes: uploadQuotaBytes(membership),
  createdAt: membership.created_at.toISOString(),
  removedAt: membership.end_user_removed_at?.toISOString() ?? null,
  closedAt: membership.end_user_closed_at?.toISOString() ?? null,
})

const isUniqueViolation = (error: unknown) =>
  (error as { code?: string } | null)?.code === '23505'

/**
 * Every refusal over an address or a customer reference. It names neither the
 * entry nor the reason, so enrolment can't be used to learn whether an address
 * has an Auto Drive account: with the entry named, a batch whose second entry
 * is sure to conflict would tell, without enrolling anyone, whether the first
 * one did. The entry and reason are logged.
 */
const enrollmentConflict = (
  organizationId: string,
  index: number,
  reason: string,
) => {
  logger.info('End user enrollment refused', { organizationId, index, reason })
  return new OrganizationConflictError(
    'An entry conflicts with an existing user or end user',
  )
}

/**
 * Enrols a partner's customers as end users of its organisation, all of them
 * or none in one transaction. A new address gets a user who signs in with that
 * wallet, onboarded, with role partner_end_user and what the partner gave for
 * them. A customer reference is permanent once given to an address, so it is
 * never reused for another person:
 * - an active end user with the same reference and quota is returned
 *   unchanged, so a retry is safe;
 * - a removed one is enrolled again with the request's quota, under the same
 *   reference only.
 * Refused, with one message: any other user of the address, another reference
 * for an end user, a reference another end user of the organisation has
 * (removed or not), and another quota for an active end user (quotas change
 * through their own route). Also refused: more than `maxEndUsers` end users
 * that are not removed. Returns the end users in request order.
 */
const enrollEndUsers = async ({
  organizationId,
  endUsers,
  maxEndUsers,
  actor,
  actorApiKeyId = null,
}: {
  organizationId: string
  endUsers: EndUserEnrollment[]
  maxEndUsers: number
  actor: string
  // The organisation API key making the request, if one is.
  actorApiKeyId?: string | null
}): Promise<PartnerEndUser[]> => {
  const requested = endUsers.map((endUser) => ({
    ...endUser,
    address: parseAddress(endUser.address),
  }))
  const addresses = requested.map((r) => r.address)
  const references = requested.map((r) => r.customerReference)
  if (
    new Set(addresses).size < addresses.length ||
    new Set(references).size < references.length
  ) {
    throw new OrganizationValidationError(
      'Each address and customer reference may appear only once',
    )
  }

  try {
    return await withTransaction(async (db) => {
      // Read FOR UPDATE, so the organisation's enrolments don't overlap and
      // the cap holds.
      const organization =
        await organizationsRepository.getOrganizationForUpdate(
          organizationId,
          db,
        )
      if (!organization) {
        throw new OrganizationNotFoundError('Organization not found')
      }
      if (organization.archived_at) {
        throw new OrganizationConflictError('Organization is archived')
      }

      const users = new Set(
        (
          await usersRepository.getUsersByOAuthUserIds(
            WALLET_PROVIDER,
            addresses,
            db,
          )
        ).map((user) => user.oauth_user_id),
      )
      const memberships = new Map(
        (
          await organizationMembersRepository.getOrganizationMembershipsByUsers(
            [...users].map((address) => ({
              oauthProvider: WALLET_PROVIDER,
              oauthUserId: address,
            })),
            db,
          )
        ).map((m) => [m.oauth_user_id, m]),
      )
      const referenceHolders = new Map(
        (
          await organizationMembersRepository.getEndUsersByCustomerReferences(
            organizationId,
            references,
            db,
          )
        ).map((m) => [m.customer_reference, m]),
      )

      // Everything is checked before anything is written.
      const plan = requested.map((request, index) => {
        const conflict = (reason: string) =>
          enrollmentConflict(organizationId, index, reason)
        const holder = referenceHolders.get(request.customerReference)
        if (
          holder &&
          (holder.oauth_provider !== WALLET_PROVIDER ||
            holder.oauth_user_id !== request.address)
        ) {
          throw conflict('customer reference held by another end user')
        }
        if (!users.has(request.address)) {
          return { request, action: 'create' as const }
        }
        const membership = memberships.get(request.address)
        if (
          membership?.organization_id !== organizationId ||
          membership.role !== OrganizationRole.PartnerEndUser
        ) {
          throw conflict('address belongs to another user')
        }
        if (membership.customer_reference !== request.customerReference) {
          throw conflict('end user has another customer reference')
        }
        if (membership.end_user_removed_at) {
          return { request, action: 'reenroll' as const }
        }
        if (uploadQuotaBytes(membership) !== request.uploadQuotaBytes) {
          throw conflict('active end user has another quota')
        }
        return { request, action: 'none' as const, membership }
      })

      const adding = plan.filter((p) => p.action !== 'none').length
      if (adding > 0) {
        const active = await organizationMembersRepository.countActiveEndUsers(
          organizationId,
          db,
        )
        if (active + adding > maxEndUsers) {
          throw new OrganizationConflictError(
            `An organization can have at most ${maxEndUsers} end users: it ` +
              `has ${active}, and this would add ${adding}`,
          )
        }
      }

      const enrolled: PartnerEndUser[] = []
      for (const step of plan) {
        if (step.action === 'none') {
          enrolled.push(toPartnerEndUser(step.membership))
          continue
        }
        const endUser = {
          oauthProvider: WALLET_PROVIDER,
          oauthUserId: step.request.address,
          customerReference: step.request.customerReference,
          uploadQuotaBytes: step.request.uploadQuotaBytes,
        }
        if (step.action === 'create') {
          // Named by its address, as wallet sign-in names a user.
          await usersRepository.createUser(
            WALLET_PROVIDER,
            endUser.oauthUserId,
            endUser.oauthUserId,
            undefined,
            deriveUserPublicId(WALLET_PROVIDER, endUser.oauthUserId),
            UserRole.User,
            db,
          )
        }
        const membership =
          step.action === 'create'
            ? await organizationMembersRepository.addEndUser(
                organizationId,
                endUser,
                db,
              )
            : await organizationMembersRepository.reenrollEndUser(
                organizationId,
                endUser,
                db,
              )
        await organizationMembershipChangesRepository.recordChange(
          {
            oauthProvider: WALLET_PROVIDER,
            oauthUserId: endUser.oauthUserId,
            fromOrganizationId: null,
            toOrganizationId: organizationId,
            role: OrganizationRole.PartnerEndUser,
            actor,
            actorApiKeyId,
            uploadQuotaBytes: endUser.uploadQuotaBytes,
          },
          db,
        )
        enrolled.push(toPartnerEndUser(membership))
      }
      return enrolled
    })
  } catch (error) {
    // A concurrent sign-up or enrolment took an address or reference first.
    if (isUniqueViolation(error)) {
      throw new OrganizationConflictError(
        'An address or customer reference was taken by a concurrent request',
      )
    }
    throw error
  }
}

/**
 * Removes a partner end user. They stay in the organisation with their files,
 * read-only, and no longer count towards its end users; enrolling them again
 * undoes it. Removing someone already removed changes nothing, so a retry is
 * safe.
 */
const removeEndUser = async ({
  organizationId,
  address,
  actor,
  actorApiKeyId = null,
}: {
  organizationId: string
  address: string
  actor: string
  // The organisation API key making the request, if one is.
  actorApiKeyId?: string | null
}): Promise<void> => {
  const oauthUserId = parseAddress(address)

  await withTransaction(async (db) => {
    const membership =
      await organizationMembersRepository.getMembershipForUpdate(
        organizationId,
        WALLET_PROVIDER,
        oauthUserId,
        db,
      )
    if (membership?.role !== OrganizationRole.PartnerEndUser) {
      throw new OrganizationNotFoundError(
        'Not an end user of this organization',
      )
    }
    if (membership.end_user_removed_at) {
      return
    }

    await organizationMembersRepository.markEndUserRemoved(
      organizationId,
      WALLET_PROVIDER,
      oauthUserId,
      db,
    )
    // They stay in the organisation: no destination marks a removal.
    await organizationMembershipChangesRepository.recordChange(
      {
        oauthProvider: WALLET_PROVIDER,
        oauthUserId,
        fromOrganizationId: organizationId,
        toOrganizationId: null,
        role: OrganizationRole.PartnerEndUser,
        actor,
        actorApiKeyId,
      },
      db,
    )
  })
}

/**
 * Sets an active end user's upload quota, null to follow the account's
 * per-person maximum, which the backend checks it against. Setting the quota
 * they already have changes nothing, so a retry is safe. Returns the end user.
 */
const setEndUserQuota = async ({
  organizationId,
  address,
  uploadQuotaBytes: quota,
  actor,
  actorApiKeyId = null,
}: {
  organizationId: string
  address: string
  uploadQuotaBytes: number | null
  actor: string
  // The organisation API key making the request, if one is.
  actorApiKeyId?: string | null
}): Promise<PartnerEndUser> => {
  const oauthUserId = parseAddress(address)

  return withTransaction(async (db) => {
    const membership =
      await organizationMembersRepository.getMembershipForUpdate(
        organizationId,
        WALLET_PROVIDER,
        oauthUserId,
        db,
      )
    if (
      membership?.role !== OrganizationRole.PartnerEndUser ||
      membership.end_user_removed_at
    ) {
      throw new OrganizationNotFoundError(
        'Not an active end user of this organization',
      )
    }
    if (uploadQuotaBytes(membership) === quota) {
      return toPartnerEndUser(membership)
    }

    const updated = await organizationMembersRepository.setEndUserQuota(
      organizationId,
      WALLET_PROVIDER,
      oauthUserId,
      quota,
      db,
    )
    await organizationMembershipChangesRepository.recordChange(
      {
        oauthProvider: WALLET_PROVIDER,
        oauthUserId,
        fromOrganizationId: organizationId,
        toOrganizationId: organizationId,
        role: OrganizationRole.PartnerEndUser,
        actor,
        actorApiKeyId,
        endUserChange: EndUserChange.QuotaChanged,
        uploadQuotaBytes: quota,
      },
      db,
    )
    return toPartnerEndUser(updated)
  })
}

// A page of the organisation's end users, removed ones included, in the order
// they were first enrolled.
const listEndUsers = async ({
  organizationId,
  limit,
  offset,
}: {
  organizationId: string
  limit: number
  offset: number
}): Promise<{ endUsers: PartnerEndUser[]; totalCount: number }> => {
  const organization =
    await organizationsRepository.getOrganizationById(organizationId)
  if (!organization) {
    throw new OrganizationNotFoundError('Organization not found')
  }

  const { endUsers, totalCount } =
    await organizationMembersRepository.getEndUsers(
      organizationId,
      limit,
      offset,
    )
  return { endUsers: endUsers.map(toPartnerEndUser), totalCount }
}

const getMembershipChanges = async (
  organizationId: string,
): Promise<OrganizationMembershipChange[]> => {
  const rows =
    await organizationMembershipChangesRepository.getChangesByOrganization(
      organizationId,
    )
  return rows.map((row) => ({
    id: row.id,
    publicId: deriveUserPublicId(row.oauth_provider, row.oauth_user_id),
    fromOrganizationId: row.from_organization_id,
    toOrganizationId: row.to_organization_id,
    role: row.role,
    actor: row.actor,
    actorApiKeyId: row.actor_api_key_id,
    endUserChange: row.end_user_change,
    uploadQuotaBytes:
      row.upload_quota_bytes === null ? null : Number(row.upload_quota_bytes),
    createdAt: row.created_at.toISOString(),
  }))
}

export const OrganizationsUseCases = {
  getMembershipByUser,
  getOrganizationByUser,
  isPartnerEndUser,
  initOrganization,
  getOrganization,
  createOrganization,
  getOrganizationSummaries,
  addMember,
  changeMemberRole,
  removeMember,
  enrollEndUsers,
  removeEndUser,
  setEndUserQuota,
  listEndUsers,
  getMembershipChanges,
  listApiKeys,
  createApiKey,
  revokeApiKey,
}
