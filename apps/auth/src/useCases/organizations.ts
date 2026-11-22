import pg from 'pg'
import { v4 } from 'uuid'
import { getAddress } from 'ethers'
import {
  MEMBER_ROLES,
  User,
  ApiKey,
  ApiKeyScope,
  ApiKeyWithoutSecret,
  Organization,
  OrganizationMembershipChange,
  OrganizationRole,
  OrganizationSummary,
  OrganizationWithMembers,
  SERVICE_USER_PROVIDER,
  UserRole,
  userFromTable,
} from '@auto-drive/models'
import {
  apiKeysRepository,
  organizationMembersRepository,
  organizationMembershipChangesRepository,
  organizationRole,
  organizationsRepository,
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

const getOrganizationByUser = async (user: User): Promise<Organization> => {
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

  return { id: organization.id, name: organization.name }
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

// End users are only ever enrolled (enrollEndUsers), never given the role.
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
    if (from?.role === OrganizationRole.EndUser) {
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
  // A user becomes an end user only when enrolment creates them, so this
  // cannot change before the update.
  const current =
    await organizationMembersRepository.getOrganizationMembershipByUser(
      user.oauth_provider,
      user.oauth_user_id,
    )
  if (current?.role === OrganizationRole.EndUser) {
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
 * without one. `endUser` removes an end user, who is removed only that way.
 */
const removeMember = async ({
  organizationId,
  publicId,
  actor,
  endUser = false,
}: {
  organizationId: string
  publicId: string
  actor: string
  endUser?: boolean
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
    const wasEndUser = removed?.role === OrganizationRole.EndUser
    if (!removed || (endUser && !wasEndUser)) {
      throw new OrganizationNotFoundError(
        endUser
          ? 'User is not an end user of this organization'
          : 'User is not a member of this organization',
      )
    }
    if (wasEndUser && !endUser) {
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

/**
 * Enrols a partner's customers as end users of its organisation: for each
 * wallet address, a user who signs in with that wallet, onboarded and with
 * role end_user, all in one transaction. An address already enrolled in this
 * organisation is returned as it is, so a retry is safe; any other user of the
 * address is refused. Returns the public IDs in request order.
 */
const enrollEndUsers = async ({
  organizationId,
  addresses,
  actor,
}: {
  organizationId: string
  addresses: string[]
  actor: string
}): Promise<Array<{ address: string; publicId: string }>> => {
  const normalised = addresses.map(parseAddress)
  if (new Set(normalised).size !== normalised.length) {
    throw new OrganizationValidationError('Each address may appear only once')
  }
  const organization =
    await organizationsRepository.getOrganizationById(organizationId)
  if (!organization) {
    throw new OrganizationNotFoundError('Organization not found')
  }
  if (organization.archived_at) {
    throw new OrganizationConflictError('Organization is archived')
  }

  const existing = await usersRepository.getUsersByOAuthUserIds(
    WALLET_PROVIDER,
    normalised,
  )
  const memberships =
    await organizationMembersRepository.getOrganizationMembershipsByUsers(
      existing.map((user) => ({
        oauthProvider: user.oauth_provider,
        oauthUserId: user.oauth_user_id,
      })),
    )
  const enrolledHere = new Set(
    memberships
      .filter(
        (m) =>
          m.organization_id === organizationId &&
          m.role === OrganizationRole.EndUser,
      )
      .map((m) => m.oauth_user_id),
  )
  const publicIds = new Map<string, string>()
  for (const user of existing) {
    if (!user.public_id || !enrolledHere.has(user.oauth_user_id)) {
      throw new OrganizationConflictError(
        `${user.oauth_user_id} is already an Auto Drive user`,
      )
    }
    publicIds.set(user.oauth_user_id, user.public_id)
  }

  return withTransaction(async (db) => {
    const enrolled = []
    for (const address of normalised) {
      let publicId = publicIds.get(address)
      if (!publicId) {
        publicId = deriveUserPublicId(WALLET_PROVIDER, address)
        // Named by its address, as wallet sign-in names a user.
        await usersRepository.createUser(
          WALLET_PROVIDER,
          address,
          address,
          undefined,
          publicId,
          UserRole.User,
          db,
        )
        await organizationMembersRepository.addMemberToOrganization(
          organizationId,
          WALLET_PROVIDER,
          address,
          OrganizationRole.EndUser,
          db,
        )
        await organizationMembershipChangesRepository.recordChange(
          {
            oauthProvider: WALLET_PROVIDER,
            oauthUserId: address,
            fromOrganizationId: null,
            toOrganizationId: organizationId,
            role: OrganizationRole.EndUser,
            actor,
          },
          db,
        )
      }
      enrolled.push({ address, publicId })
    }
    return enrolled
  })
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
    createdAt: row.created_at.toISOString(),
  }))
}

export const OrganizationsUseCases = {
  getOrganizationByUser,
  initOrganization,
  getOrganization,
  createOrganization,
  getOrganizationSummaries,
  addMember,
  changeMemberRole,
  removeMember,
  enrollEndUsers,
  getMembershipChanges,
  listApiKeys,
  createApiKey,
  revokeApiKey,
}
