import { v4 } from 'uuid'
import {
  User,
  UserRole,
  UserWithOrganization,
  Subscription,
  SubscriptionGranularity,
  SubscriptionInfo,
  InteractionType,
} from '@auto-drive/models'
import { subscriptionsRepository } from '../../repositories/users/subscriptions.js'
import { interactionsRepository } from '../../repositories/objects/interactions.js'
import { InteractionsUseCases } from '../objects/interactions.js'
import { AuthManager } from '../../services/auth/index.js'
import { config } from '../../config.js'

const updateSubscription = async (
  executor: User,
  userPublicId: string,
  granularity: SubscriptionGranularity,
  uploadLimit: number,
  downloadLimit: number,
): Promise<void> => {
  if (executor.role !== UserRole.Admin) {
    throw new Error('User does not have admin privileges')
  }

  const user = await AuthManager.getUserFromPublicId(userPublicId)
  if (!user.organizationId) {
    throw new Error('User organization ID is required')
  }

  const subscription = await subscriptionsRepository.getByOrganizationId(
    user.organizationId,
  )

  if (!subscription) {
    throw new Error('Subscription not found')
  }

  await subscriptionsRepository.updateSubscription(
    subscription.id,
    granularity,
    uploadLimit,
    downloadLimit,
  )
}

const getOrCreateSubscription = async (
  user: UserWithOrganization,
): Promise<Subscription> => {
  if (!user.organizationId) {
    throw new Error('User organization ID is required')
  }

  const subscription = await subscriptionsRepository.getByOrganizationId(
    user.organizationId,
  )
  if (!subscription) {
    const isWeb3User = user.oauthProvider === 'auto-evm'
    if (isWeb3User) {
      return initSubscription(user.organizationId, 0, 0)
    } else {
      return initSubscription(
        user.organizationId,
        config.params.defaultSubscription.uploadLimit,
        config.params.defaultSubscription.downloadLimit,
      )
    }
  }

  return subscription
}

const getSubscriptionById = async (
  id: string,
): Promise<Subscription | null> => {
  return subscriptionsRepository.getById(id)
}

const initSubscription = async (
  organizationId: string,
  uploadLimit: number,
  downloadLimit: number,
): Promise<Subscription> => {
  const subscription =
    await subscriptionsRepository.getByOrganizationId(organizationId)
  if (subscription) {
    throw new Error('Subscription already exists')
  }

  const newSubscription = {
    id: v4(),
    organizationId,
    granularity: config.params.defaultSubscription
      .granularity as SubscriptionGranularity,
    uploadLimit,
    downloadLimit,
  }
  await subscriptionsRepository.createSubscription(
    newSubscription.id,
    organizationId,
    newSubscription.granularity,
    newSubscription.uploadLimit,
    newSubscription.downloadLimit,
  )

  return newSubscription
}

const getPendingCreditsBySubscriptionAndType = async (
  subscription: Subscription,
  type: InteractionType,
): Promise<number> => {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth(), 1, 0, 0, 0, 0)
  const interactions =
    await interactionsRepository.getInteractionsBySubscriptionIdAndTypeInTimeRange(
      subscription.id,
      type,
      start,
      end,
    )

  const spentCredits = interactions.reduce((acc, interaction) => {
    return acc + interaction.size
  }, 0)

  const limit =
    type === InteractionType.Upload
      ? subscription.uploadLimit
      : subscription.downloadLimit

  return limit - spentCredits
}

const getSubscriptionInfo = async (
  user: UserWithOrganization,
): Promise<SubscriptionInfo> => {
  const subscription = await getOrCreateSubscription(user)

  const pendingUploadCredits = await getPendingCreditsBySubscriptionAndType(
    subscription,
    InteractionType.Upload,
  )
  const pendingDownloadCredits = await getPendingCreditsBySubscriptionAndType(
    subscription,
    InteractionType.Download,
  )

  return {
    ...subscription,
    pendingUploadCredits,
    pendingDownloadCredits,
  }
}

const getUserListSubscriptions = async (
  userPublicIds: string[],
): Promise<Record<string, SubscriptionInfo>> => {
  return Object.fromEntries(
    await Promise.all(
      userPublicIds.map(async (userPublicId) => {
        const user = await AuthManager.getUserFromPublicId(userPublicId)
        return [userPublicId, await getSubscriptionInfo(user)]
      }),
    ),
  )
}

const getPendingCreditsByUserAndType = async (
  user: UserWithOrganization,
  type: InteractionType,
): Promise<number> => {
  const subscription = await getOrCreateSubscription(user)

  return getPendingCreditsBySubscriptionAndType(subscription, type)
}

const registerInteraction = async (
  user: UserWithOrganization,
  type: InteractionType,
  size: bigint,
) => {
  const subscription = await getOrCreateSubscription(user)

  await InteractionsUseCases.createInteraction(subscription.id, type, size)
}

export const SubscriptionsUseCases = {
  updateSubscription,
  getOrCreateSubscription,
  initSubscription,
  getPendingCreditsBySubscriptionAndType,
  getSubscriptionInfo,
  getPendingCreditsByUserAndType,
  registerInteraction,
  getUserListSubscriptions,
  getSubscriptionById,
}
