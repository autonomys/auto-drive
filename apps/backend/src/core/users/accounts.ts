import { v4 } from 'uuid'
import {
  User,
  UserRole,
  UserWithOrganization,
  AccountModel,
  Account,
  InteractionType,
  AccountInfo,
} from '@auto-drive/models'
import { accountsRepository } from '../../infrastructure/repositories/users/accounts.js'
import { interactionsRepository } from '../../infrastructure/repositories/objects/interactions.js'
import { InteractionsUseCases } from '../objects/interactions.js'
import { AuthManager } from '../../infrastructure/services/auth/index.js'
import { config } from '../../config.js'
import { err, ok, Result } from 'neverthrow'
import { ForbiddenError, ObjectNotFoundError } from '../../errors/index.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('AccountsUseCases')

const updateAccount = async (
  executor: User,
  userPublicId: string,
  granularity: AccountModel,
  uploadLimit: number,
  downloadLimit: number,
): Promise<Result<void, ForbiddenError | ObjectNotFoundError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('User does not have admin privileges'))
  }

  const user = await AuthManager.getUserFromPublicId(userPublicId)
  if (!user.organizationId) {
    return err(new ObjectNotFoundError('User has no organization ID'))
  }

  const subscription = await accountsRepository.getByOrganizationId(
    user.organizationId,
  )
  if (!subscription) {
    return err(new ObjectNotFoundError('Subscription not found'))
  }

  await accountsRepository.updateSubscription(
    subscription.id,
    granularity,
    uploadLimit,
    downloadLimit,
  )

  return ok()
}

const getOrCreateSubscription = async (
  user: UserWithOrganization,
): Promise<Account> => {
  if (!user.organizationId) {
    throw new Error('User organization ID is required')
  }

  const subscription = await accountsRepository.getByOrganizationId(
    user.organizationId,
  )
  if (!subscription) {
    const isWeb3User = user.oauthProvider === 'web3-wallet'
    if (isWeb3User) {
      return initSubscription(
        user.organizationId,
        config.params.web3DefaultSubscription.uploadLimit,
        config.params.web3DefaultSubscription.downloadLimit,
      )
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

const getSubscriptionById = async (id: string): Promise<Account | null> => {
  return accountsRepository.getById(id)
}

const initSubscription = async (
  organizationId: string,
  uploadLimit: number,
  downloadLimit: number,
): Promise<Account> => {
  const subscription =
    await accountsRepository.getByOrganizationId(organizationId)
  if (subscription) {
    throw new Error('Subscription already exists')
  }

  const newSubscription = {
    id: v4(),
    organizationId,
    model: config.params.defaultSubscription.granularity as AccountModel,
    uploadLimit,
    downloadLimit,
  }
  await accountsRepository.createSubscription(
    newSubscription.id,
    organizationId,
    newSubscription.model,
    newSubscription.uploadLimit,
    newSubscription.downloadLimit,
  )

  return newSubscription
}

const getPendingCreditsBySubscriptionAndType = async (
  subscription: Account,
  type: InteractionType,
): Promise<number> => {
  const end = new Date()
  const start =
    subscription.model === AccountModel.Monthly
      ? new Date(end.getFullYear(), end.getMonth(), 1, 0, 0, 0, 0)
      : new Date(0)

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
): Promise<AccountInfo> => {
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

const getUserListAccount = async (
  userPublicIds: string[],
): Promise<Record<string, AccountInfo>> => {
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

export const AccountsUseCases = {
  updateAccount,
  getOrCreateSubscription,
  initSubscription,
  getPendingCreditsBySubscriptionAndType,
  getSubscriptionInfo,
  getPendingCreditsByUserAndType,
  registerInteraction,
  getUserListAccount,
  getSubscriptionById,
}
