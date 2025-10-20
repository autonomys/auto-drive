import { v4 } from 'uuid'
import {
  User,
  UserRole,
  UserWithOrganization,
  AccountModel,
  Account,
  InteractionType,
  AccountInfo,
  AccountWithTotalSize,
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
  model: AccountModel,
  uploadLimit: number,
  downloadLimit: number,
): Promise<Result<void, ForbiddenError | ObjectNotFoundError>> => {
  if (executor.role !== UserRole.Admin) {
    logger.warn('User does not have admin privileges', {
      userPublicId,
      model,
      uploadLimit,
      downloadLimit,
    })
    return err(new ForbiddenError('User does not have admin privileges'))
  }

  const user = await AuthManager.getUserFromPublicId(userPublicId)
  if (!user.organizationId) {
    return err(new ObjectNotFoundError('User has no organization ID'))
  }

  const account = await accountsRepository.getByOrganizationId(
    user.organizationId,
  )
  if (!account) {
    logger.warn('Account not found', {
      userPublicId,
      model,
      uploadLimit,
      downloadLimit,
    })
    return err(new ObjectNotFoundError('Account not found'))
  }

  logger.debug('Updating account', {
    userPublicId,
    model,
    uploadLimit,
    downloadLimit,
  })

  await accountsRepository.updateAccount(
    account.id,
    model,
    uploadLimit,
    downloadLimit,
  )

  return ok()
}

const getOrCreateAccount = async (
  user: UserWithOrganization,
): Promise<Account> => {
  if (!user.organizationId) {
    throw new Error('User organization ID is required')
  }

  const account = await accountsRepository.getByOrganizationId(
    user.organizationId,
  )
  if (!account) {
    const isWeb3User = user.oauthProvider === 'web3-wallet'
    if (isWeb3User) {
      return initAccount(
        user.organizationId,
        config.params.web3DefaultAccount.uploadLimit,
        config.params.web3DefaultAccount.downloadLimit,
      )
    } else {
      return initAccount(
        user.organizationId,
        config.params.defaultAccount.uploadLimit,
        config.params.defaultAccount.downloadLimit,
      )
    }
  }

  return account
}

const getAccountById = async (id: string): Promise<Account | null> => {
  return accountsRepository.getById(id)
}

const initAccount = async (
  organizationId: string,
  uploadLimit: number,
  downloadLimit: number,
): Promise<Account> => {
  const account = await accountsRepository.getByOrganizationId(organizationId)
  if (account) {
    throw new Error('Account already exists')
  }

  const newAccount = {
    id: v4(),
    organizationId,
    model: config.params.defaultAccount.model as AccountModel,
    uploadLimit,
    downloadLimit,
  }
  await accountsRepository.createAccount(
    newAccount.id,
    organizationId,
    newAccount.model,
    newAccount.uploadLimit,
    newAccount.downloadLimit,
  )

  return newAccount
}

const getPendingCreditsByAccountAndType = async (
  account: Account,
  type: InteractionType,
): Promise<number> => {
  const end = new Date()
  const start =
    account.model === AccountModel.Monthly
      ? new Date(end.getFullYear(), end.getMonth(), 1, 0, 0, 0, 0)
      : new Date(0)

  const interactions =
    await interactionsRepository.getInteractionsByAccountIdAndTypeInTimeRange(
      account.id,
      type,
      start,
      end,
    )

  const spentCredits = interactions.reduce((acc, interaction) => {
    return acc + interaction.size
  }, 0)

  const limit =
    type === InteractionType.Upload
      ? account.uploadLimit
      : account.downloadLimit

  return limit - spentCredits
}

const getAccountInfo = async (
  user: UserWithOrganization,
): Promise<AccountInfo> => {
  const account = await getOrCreateAccount(user)

  const pendingUploadCredits = await getPendingCreditsByAccountAndType(
    account,
    InteractionType.Upload,
  )
  const pendingDownloadCredits = await getPendingCreditsByAccountAndType(
    account,
    InteractionType.Download,
  )

  return {
    ...account,
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
        return [userPublicId, await getAccountInfo(user)]
      }),
    ),
  )
}

const getPendingCreditsByUserAndType = async (
  user: UserWithOrganization,
  type: InteractionType,
): Promise<number> => {
  const account = await getOrCreateAccount(user)

  return getPendingCreditsByAccountAndType(account, type)
}

const registerInteraction = async (
  user: UserWithOrganization,
  type: InteractionType,
  size: bigint,
) => {
  const account = await getOrCreateAccount(user)

  await InteractionsUseCases.createInteraction(account.id, type, size)
}

const addCreditsToAccount = async (publicId: string, credits: number) => {
  const user = await AuthManager.getUserFromPublicId(publicId)
  if (!user) {
    return err(new ObjectNotFoundError('User not found'))
  }

  const account = await AccountsUseCases.getOrCreateAccount(user)
  if (!account) {
    return err(new ObjectNotFoundError('Account not found'))
  }

  if (account.model !== AccountModel.OneOff) {
    return err(new ForbiddenError('Account is not OneOff'))
  }

  await accountsRepository.updateAccount(
    account.id,
    account.model,
    account.uploadLimit + credits,
    account.downloadLimit + credits,
  )

  return ok()
}

const getTopAccounts = async (
  user: User,
  {
    fromDate,
    toDate,
    limit = 10,
  }: {
    limit: number | undefined
    fromDate: Date | null
    toDate: Date | null
  },
): Promise<Result<AccountWithTotalSize[], ForbiddenError>> => {
  if (user.role !== UserRole.Admin) {
    logger.warn('User does not have admin privileges', {
      userPublicId: user.publicId,
    })
    return err(new ForbiddenError('User does not have admin privileges'))
  }
  return ok(
    await accountsRepository.getTopAccountsWithinPeriod(
      InteractionType.Upload,
      fromDate ?? new Date(0),
      toDate ?? new Date(),
      limit,
    ),
  )
}

export const AccountsUseCases = {
  updateAccount,
  getOrCreateAccount,
  initAccount,
  getPendingCreditsByAccountAndType,
  getAccountInfo,
  getPendingCreditsByUserAndType,
  registerInteraction,
  addCreditsToAccount,
  getUserListAccount,
  getAccountById,
  getTopAccounts,
}
