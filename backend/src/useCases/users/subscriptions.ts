import { v4 } from 'uuid'
import {
  User,
  UserRole,
  UserWithOrganization,
} from '../../models/users/user.js'
import {
  Subscription,
  SubscriptionGranularity,
  SubscriptionInfo,
} from '../../models/users/subscription.js'
import { subscriptionsRepository } from '../../repositories/users/subscriptions.js'
import { interactionsRepository } from '../../repositories/objects/interactions.js'
import { InteractionType } from '../../models/objects/interactions.js'
import { InteractionsUseCases } from '../objects/interactions.js'

const updateSubscription = async (
  executor: User,
  user: UserWithOrganization,
  granularity: SubscriptionGranularity,
  uploadLimit: number,
  downloadLimit: number,
): Promise<void> => {
  if (executor.role !== UserRole.Admin) {
    throw new Error('User does not have admin privileges')
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
  const subscription = await subscriptionsRepository.getByOrganizationId(
    user.organizationId,
  )
  if (!subscription) {
    return initSubscription(user.organizationId)
  }

  return subscription
}

const initSubscription = async (
  organizationId: string,
): Promise<Subscription> => {
  const subscription =
    await subscriptionsRepository.getByOrganizationId(organizationId)
  if (subscription) {
    throw new Error('Subscription already exists')
  }

  const INITIAL_GRANULARITY: SubscriptionGranularity = 'monthly'
  const HUNDRED_MB = 1024 ** 2 * 100
  const FIVE_GB = 1024 ** 3 * 5
  const INITIAL_UPLOAD_LIMIT: number = HUNDRED_MB
  const INITIAL_DOWNLOAD_LIMIT: number = FIVE_GB

  const newSubscription = {
    id: v4(),
    organizationId,
    granularity: INITIAL_GRANULARITY,
    uploadLimit: INITIAL_UPLOAD_LIMIT,
    downloadLimit: INITIAL_DOWNLOAD_LIMIT,
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
  const start = new Date(end.getFullYear(), end.getMonth(), 1)
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
}
