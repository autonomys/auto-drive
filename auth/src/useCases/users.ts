import {
  MaybeUser,
  MaybeUserWithOrganization,
  OAuthUser,
  User,
  userFromOAuth,
  userFromTable,
  UserOrPublicId,
  UserRole,
} from '@auto-drive/models'
import { usersRepository } from '../repositories/users.js'
import { OrganizationsUseCases } from './organizations.js'
import { v5 } from 'uuid'

const getUserByPublicId = async (
  publicId: string,
): Promise<User | undefined> => {
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
    email: dbUser.email,
  })
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
    throw new Error('User not found')
  }

  return user
}

const generateUserPublicId = (user: MaybeUser): string => {
  const USER_PUBLIC_ID_NAMESPACE = 'public-id-user-1'

  const input = `${user.oauthProvider}-${user.oauthUserId}`
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
  if (user.onboarded) {
    return user
  }

  const publicId = generateUserPublicId(user)

  const updatedUser = await UsersUseCases.initUser(
    user.oauthProvider,
    user.oauthUserId,
    user.oauthUsername,
    user.oauthAvatarUrl,
    user.email,
    publicId,
    UserRole.User,
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

  // If the user has an email and has no email in the database, update the email
  if (user.email && !dbUser.email) {
    await usersRepository.updateEmail(user.provider, user.id, user.email)
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
  email: string | undefined,
  publicId: string,
  role: UserRole,
): Promise<User> => {
  const user = await usersRepository.createUser(
    oauthProvider,
    oauthUserId,
    oauthUsername,
    oauthAvatarUrl,
    email,
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

export const getUserList = async (executor: User): Promise<User[]> => {
  const isAdmin = await isAdminUser(executor)
  if (!isAdmin) {
    throw new Error('User does not have admin privileges')
  }

  const users = await usersRepository.getAllUsers()

  return users.map((user) =>
    userFromTable({
      oauthProvider: user.oauth_provider,
      oauthUserId: user.oauth_user_id,
      publicId: user.public_id,
      role: user.role,
    }),
  )
}

export const UsersUseCases = {
  onboardUser,
  getUserByOAuthUser,
  getUserByPublicId,
  searchUsersByPublicId,
  isAdminUser,
  updateRole,
  resolveUser,
  initUser,
  getUserWithOrganization,
  getUserList,
}
