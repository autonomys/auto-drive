import {
  OAuthUser,
  User,
  userFromOAuth,
  userFromTable,
  UserInfo,
  UserOrPublicId,
  UserRole,
} from '../../models/users/index.js'
import { InteractionType } from '../../models/objects/interactions.js'
import { SubscriptionWithUser } from '../../models/users/subscription.js'
import { usersRepository } from '../../repositories/index.js'
import { InteractionsUseCases } from '../objects/interactions.js'
import { OrganizationsUseCases } from './organizations.js'
import { SubscriptionsUseCases } from './subscriptions.js'
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
  })
}

const resolveUser = async (userOrPublicId: UserOrPublicId): Promise<User> => {
  if (userOrPublicId === null) {
    throw new Error('User not found (user=null)')
  }

  const isPublicId = typeof userOrPublicId === 'string'
  const user: User | undefined = isPublicId
    ? await getUserByPublicId(userOrPublicId)
    : userOrPublicId
  if (!user) {
    throw new Error('User not found')
  }
  return user
}

const generateUserPublicId = (user: User): string => {
  const USER_PUBLIC_ID_NAMESPACE = 'public-id-user-1'

  const input = `${user.oauthProvider}-${user.oauthUserId}`
  const namespaceArray = USER_PUBLIC_ID_NAMESPACE.split('').map((e) =>
    e.charCodeAt(0),
  )
  return v5(input, namespaceArray)
}

const onboardUser = async (user: User): Promise<User | undefined> => {
  const publicId = generateUserPublicId(user)

  const updatedUser = await UsersUseCases.initUser(
    user.oauthProvider,
    user.oauthUserId,
    publicId,
  )

  return updatedUser
}

const getUserByOAuthUser = async (user: OAuthUser): Promise<User> => {
  const dbUser = await usersRepository.getUserByOAuthInformation(
    user.provider,
    user.id,
  )
  if (!dbUser) {
    return userFromOAuth({
      oauthProvider: user.provider,
      oauthUserId: user.id,
      role: UserRole.User,
    })
  }

  return userFromTable({
    oauthProvider: dbUser.oauth_provider,
    oauthUserId: dbUser.oauth_user_id,
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

  const user = await resolveUser(userOrPublicId)

  return usersRepository.updateRole(user.oauthProvider, user.oauthUserId, role)
}

const getUserInfo = async (
  userOrPublicId: UserOrPublicId,
): Promise<UserInfo> => {
  const user = await resolveUser(userOrPublicId)

  if (!user.onboarded) {
    return {
      user,
    }
  }

  const subscription = await SubscriptionsUseCases.getSubscriptionInfo(user)

  return {
    user,
    subscription,
  }
}

const getUserList = async (reader: User): Promise<SubscriptionWithUser[]> => {
  const isAdmin = await UsersUseCases.isAdminUser(reader)
  if (!isAdmin) {
    throw new Error('User does not have admin privileges')
  }

  const users = await usersRepository.getAllUsers()

  return Promise.all(
    users.map(async (user) => {
      const subscription = await SubscriptionsUseCases.getSubscription(
        user.public_id,
      )
      return {
        ...subscription,
        user: userFromTable({
          oauthProvider: user.oauth_provider,
          oauthUserId: user.oauth_user_id,
          publicId: user.public_id,
          role: user.role,
        }),
      }
    }),
  )
}

const initUser = async (
  oauthProvider: string,
  oauthUserId: string,
  publicId: string,
  role: UserRole = UserRole.User,
): Promise<User> => {
  const user = await usersRepository.createUser(
    oauthProvider,
    oauthUserId,
    publicId,
    role,
  )
  if (!user) {
    throw new Error('User creation failed')
  }

  await OrganizationsUseCases.initOrganization(
    userFromTable({
      oauthProvider: oauthProvider,
      oauthUserId: oauth_user_id,
      publicId: publicId,
      role: role,
    }),
  )

  return userFromTable({
    oauthProvider: user.oauth_provider,
    oauthUserId: user.oauth_user_id,
    publicId: user.public_id,
    role: user.role,
  })
}

const getPendingCreditsByUserAndType = async (
  userOrPublicId: UserOrPublicId,
  type: InteractionType,
): Promise<number> => {
  const subscription =
    await SubscriptionsUseCases.getSubscription(userOrPublicId)

  return SubscriptionsUseCases.getPendingCreditsBySubscriptionAndType(
    subscription,
    type,
  )
}

const registerInteraction = async (
  userOrPublicId: UserOrPublicId,
  type: InteractionType,
  size: number,
) => {
  const subscription =
    await SubscriptionsUseCases.getSubscription(userOrPublicId)

  await InteractionsUseCases.createInteraction(subscription.id, type, size)
}

export const UsersUseCases = {
  onboardUser,
  getUserByOAuthUser,
  getUserByPublicId,
  searchUsersByPublicId,
  isAdminUser,
  updateRole,
  resolveUser,
  getUserList,
  getPendingCreditsByUserAndType,
  getUserInfo,
  initUser,
  registerInteraction,
}
