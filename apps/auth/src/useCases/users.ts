import {
  MaybeUser,
  MaybeUserWithOrganization,
  OAuthUser,
  PaginatedResult,
  User,
  userFromOAuth,
  userFromTable,
  UserOrPublicId,
  UserRole,
} from '@auto-drive/models'
import { usersRepository } from '../repositories/users.js'
import { organizationMembersRepository } from '../repositories/organizationMembers.js'
import { OrganizationsUseCases } from './organizations.js'
import { v5 } from 'uuid'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('useCases:users')

const getUserByPublicId = async (
  publicId: string,
): Promise<User | undefined> => {
  logger.trace('Fetching user by publicId %s', publicId)
  const dbUser = await usersRepository.getUserByPublicId(publicId)
  if (!dbUser) {
    return undefined
  }

  return userFromTable({
    oauthProvider: dbUser.oauth_provider,
    oauthUserId: dbUser.oauth_user_id,
    publicId: dbUser.public_id,
    role: dbUser.role,
    oauthUsername: dbUser.oauth_username,
    oauthAvatarUrl: dbUser.oauth_avatar_url,
  })
}

const getUsersByPublicIds = async (publicIds: string[]): Promise<User[]> => {
  logger.trace('Fetching users by publicIds %s', publicIds.join(', '))
  const dbUsers = await usersRepository.getUsersByPublicIds(publicIds)

  return dbUsers.map((dbUser) =>
    userFromTable({
      oauthProvider: dbUser.oauth_provider,
      oauthUserId: dbUser.oauth_user_id,
      publicId: dbUser.public_id,
      role: dbUser.role,
      oauthUsername: dbUser.oauth_username,
      oauthAvatarUrl: dbUser.oauth_avatar_url,
    }),
  )
}

const resolveUser = async (
  userOrPublicId: UserOrPublicId,
): Promise<MaybeUser> => {
  if (userOrPublicId === null) {
    throw new Error('User not found (user=null)')
  }

  const isPublicId = typeof userOrPublicId === 'string'
  const user: MaybeUser | undefined = isPublicId
    ? await getUserByPublicId(userOrPublicId)
    : userOrPublicId
  if (!user) {
    logger.warn('User not found %s', userOrPublicId)
    throw new Error('User not found')
  }

  return user
}

export const deriveUserPublicId = (
  oauthProvider: string,
  oauthUserId: string,
): string => {
  const USER_PUBLIC_ID_NAMESPACE = 'public-id-user-1'

  const input = `${oauthProvider}-${oauthUserId}`
  return v5(input, Buffer.from(USER_PUBLIC_ID_NAMESPACE))
}

const getUserWithOrganization = async (
  user: UserOrPublicId,
): Promise<MaybeUserWithOrganization> => {
  const resolvedUser = await resolveUser(user)

  if (!resolvedUser.onboarded) {
    return { ...resolvedUser, organizationId: null }
  }

  const organization =
    await OrganizationsUseCases.getOrganizationByUser(resolvedUser)

  return {
    ...resolvedUser,
    organizationId: organization.id,
  }
}

const onboardUser = async (user: MaybeUser): Promise<User | undefined> => {
  logger.debug('Onboarding user %s:%s', user.oauthProvider, user.oauthUserId)
  if (user.onboarded) {
    return user
  }

  const publicId = deriveUserPublicId(user.oauthProvider, user.oauthUserId)

  const updatedUser = await UsersUseCases.initUser(
    user.oauthProvider,
    user.oauthUserId,
    user.oauthUsername,
    user.oauthAvatarUrl,
    publicId,
    UserRole.User,
  )

  logger.debug(
    'Onboarded user %s:%s with publicId %s',
    user.oauthProvider,
    user.oauthUserId,
    publicId,
  )

  return updatedUser
}

const getUserByOAuthUser = async (user: OAuthUser): Promise<MaybeUser> => {
  const dbUser = await usersRepository.getUserByOAuthInformation(
    user.provider,
    user.id,
  )
  if (!dbUser) {
    return userFromOAuth({
      oauthProvider: user.provider,
      oauthUserId: user.id,
      oauthUsername: user.username,
      oauthAvatarUrl: user.avatarUrl,
      role: UserRole.User,
    })
  }

  // If the user has a username and has been updated, update the username
  if (user.username && dbUser.oauth_username !== user.username) {
    await usersRepository.updateUsername(user.provider, user.id, user.username)
  }

  // If the user has an avatar url and has been updated, update the avatar url
  if (user.avatarUrl && dbUser.oauth_avatar_url !== user.avatarUrl) {
    await usersRepository.updateAvatarUrl(
      user.provider,
      user.id,
      user.avatarUrl,
    )
  }

  return userFromTable({
    oauthProvider: user.provider,
    oauthUserId: user.id,
    oauthUsername: user.username,
    oauthAvatarUrl: user.avatarUrl,
    publicId: dbUser.public_id,
    role: dbUser.role,
  })
}

const searchUsersByPublicId = async (publicId: string): Promise<string[]> => {
  const maxResults = 10
  const dbUsers = await usersRepository.searchUsersByPublicId(
    publicId,
    maxResults,
  )

  return dbUsers.map((e) => e.public_id)
}

const isAdminUser = async (
  userOrPublicId: UserOrPublicId,
): Promise<boolean> => {
  const user = await resolveUser(userOrPublicId)

  const adminUser = await usersRepository.getUserByOAuthInformation(
    user.oauthProvider,
    user.oauthUserId,
  )

  return adminUser?.role === UserRole.Admin
}

const updateRole = async (
  executor: User,
  userOrPublicId: UserOrPublicId,
  role: UserRole,
) => {
  logger.info('Updating role to %s by admin %s', role, executor.publicId)
  const isAdmin = await isAdminUser(executor)
  if (!isAdmin) {
    throw new Error('User does not have admin privileges')
  }
  if (!Object.values(UserRole).includes(role)) {
    throw new Error('Invalid role')
  }

  const user = await resolveUser(userOrPublicId)

  return usersRepository.updateRole(user.oauthProvider, user.oauthUserId, role)
}

const initUser = async (
  oauthProvider: string,
  oauthUserId: string,
  oauthUsername: string | undefined,
  oauthAvatarUrl: string | undefined,
  publicId: string,
  role: UserRole,
): Promise<User> => {
  logger.info('Initializing new user %s', publicId)
  const user = await usersRepository.createUser(
    oauthProvider,
    oauthUserId,
    oauthUsername,
    oauthAvatarUrl,
    publicId,
    role,
  )
  if (!user) {
    throw new Error('User creation failed')
  }

  const onboardedUser = userFromTable({
    oauthProvider: user.oauth_provider,
    oauthUserId: user.oauth_user_id,
    oauthUsername: user.oauth_username,
    oauthAvatarUrl: user.oauth_avatar_url,
    publicId: user.public_id,
    role: user.role,
  })
  await OrganizationsUseCases.initOrganization(onboardedUser)

  return onboardedUser
}

export const getPaginatedUserList = async (
  executor: User,
  page: number = 1,
  limit: number = 10,
): Promise<PaginatedResult<User>> => {
  logger.trace(
    'Paginated user list requested by %s page=%d limit=%d',
    executor.publicId,
    page,
    limit,
  )
  const isAdmin = await isAdminUser(executor)
  if (!isAdmin) {
    throw new Error('User does not have admin privileges')
  }

  const { totalCount, rows } = await usersRepository.getPaginatedUsers(
    page,
    limit,
  )

  return {
    totalCount,
    rows: rows.map((user) =>
      userFromTable({
        oauthProvider: user.oauth_provider,
        oauthUserId: user.oauth_user_id,
        publicId: user.public_id,
        role: user.role,
      }),
    ),
  }
}

const getUsersWithOrganizations = async (
  publicIds: string[],
): Promise<MaybeUserWithOrganization[]> => {
  const users = await getUsersByPublicIds(publicIds)
  const onboardedUsers = users.filter((u) => u.onboarded)

  const memberships =
    await organizationMembersRepository.getOrganizationMembershipsByUsers(
      onboardedUsers.map((u) => ({
        oauthProvider: u.oauthProvider,
        oauthUserId: u.oauthUserId,
      })),
    )

  const orgByUser = new Map<string, string>()
  for (const m of memberships) {
    const key = `${m.oauth_provider}:${m.oauth_user_id}`
    if (!orgByUser.has(key)) {
      orgByUser.set(key, m.organization_id)
    }
  }

  return users.map((user) => {
    if (!user.onboarded) {
      return { ...user, organizationId: null }
    }
    const orgId =
      orgByUser.get(`${user.oauthProvider}:${user.oauthUserId}`) || null
    return { ...user, organizationId: orgId }
  })
}

export const UsersUseCases = {
  onboardUser,
  getUserByOAuthUser,
  getUserByPublicId,
  getUsersByPublicIds,
  searchUsersByPublicId,
  isAdminUser,
  updateRole,
  resolveUser,
  initUser,
  getUserWithOrganization,
  getUsersWithOrganizations,
  getPaginatedUserList,
}
