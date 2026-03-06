import { v4 } from 'uuid'
import {
  User,
  UserRole,
  UserWithOrganization,
  AccountModel,
  Account,
  InteractionType,
  InteractionSource,
  AccountInfo,
  AccountWithTotalSize,
} from '@auto-drive/models'
import { accountsRepository } from '../../infrastructure/repositories/users/accounts.js'
import { interactionsRepository } from '../../infrastructure/repositories/objects/interactions.js'
import {
  purchasedCreditsRepository,
  InsufficientPurchasedCreditsError,
} from '../../infrastructure/repositories/users/purchasedCredits.js'
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
      return AccountsUseCases.initAccount(
        user.organizationId,
        config.params.web3DefaultAccount.uploadLimit,
        config.params.web3DefaultAccount.downloadLimit,
      )
    } else {
      return AccountsUseCases.initAccount(
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

  // Only count free-tier interactions against the free/one-off limit.
  // Interactions sourced from purchased credits are tracked separately and
  // must not reduce the free allocation.
  const interactions =
    await interactionsRepository.getInteractionsByAccountIdAndTypeInTimeRange(
      account.id,
      type,
      start,
      end,
      InteractionSource.FreeTier,
    )

  const spentCredits = interactions.reduce((acc, interaction) => {
    return acc + interaction.size
  }, 0)

  const limit =
    type === InteractionType.Upload
      ? account.uploadLimit
      : account.downloadLimit

  const freeRemaining = limit - spentCredits

  // Also include any active purchased credits so the upload/download gate
  // (pendingCredits < metadata.totalSize) grants access when the user has
  // enough purchased bytes, even if their free allocation is exhausted.
  // When buyCredits is disabled, getRemainingCredits returns 0, so there
  // is no change in behaviour for pure free/one-off accounts.
  const purchased = await purchasedCreditsRepository.getRemainingCredits(
    account.id,
  )
  const purchasedRemaining =
    type === InteractionType.Upload
      ? Number(purchased.uploadBytesRemaining)
      : Number(purchased.downloadBytesRemaining)

  return freeRemaining + purchasedRemaining
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
  if (userPublicIds.length === 0) return {}

  const users = await AuthManager.getUsersFromPublicIds(userPublicIds)
  const usersByPublicId = new Map(users.map((u) => [u.publicId, u]))

  const entries = await Promise.all(
    userPublicIds
      .filter((id) => usersByPublicId.has(id))
      .map(async (id) => [id, await getAccountInfo(usersByPublicId.get(id)!)]),
  )

  return Object.fromEntries(entries)
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
): Promise<void> => {
  const account = await getOrCreateAccount(user)
  const creditType = type === InteractionType.Upload ? 'upload' : 'download'

  logger.debug(
    'Registering interaction (accountId=%s, type=%s, size=%d)',
    account.id,
    type,
    size,
  )

  // --- Step 1: try to cover the full amount from purchased credits. ---
  const consumeResult = await purchasedCreditsRepository.consumeCredits(
    account.id,
    creditType,
    size,
  )

  if (consumeResult.isOk()) {
    // Purchased credits covered everything.
    await InteractionsUseCases.createInteraction(
      account.id,
      type,
      size,
      InteractionSource.Purchased,
    )
    return
  }

  // --- Step 2: purchased credits are insufficient (or zero). ---
  const insufficientErr = consumeResult.error as InsufficientPurchasedCreditsError
  let fromPurchased = insufficientErr.available

  // Drain whatever purchased bytes remain before falling back to the free tier.
  if (fromPurchased > BigInt(0)) {
    // Attempt to consume the exact available amount.
    const secondConsumeResult = await purchasedCreditsRepository.consumeCredits(
      account.id,
      creditType,
      fromPurchased,
    )

    // Under concurrency, another request might have consumed these credits
    // between our first call's ROLLBACK and this call. Check the result.
    if (secondConsumeResult.isOk()) {
      await InteractionsUseCases.createInteraction(
        account.id,
        type,
        fromPurchased,
        InteractionSource.Purchased,
      )
    } else {
      // Concurrent request consumed the credits; set fromPurchased to 0.
      fromPurchased = BigInt(0)
    }
  }

  // --- Step 3: cover the remainder from the free/one-off allocation. ---
  const fromFree = size - fromPurchased

  logger.debug(
    'Falling back to free-tier for remainder (accountId=%s, fromPurchased=%d, fromFree=%d)',
    account.id,
    fromPurchased,
    fromFree,
  )

  await InteractionsUseCases.createInteraction(
    account.id,
    type,
    fromFree,
    InteractionSource.FreeTier,
  )
}

const addCreditsToAccount = async (
  publicId: string,
  credits: bigint,
  intentId: string,
): Promise<Result<void, ForbiddenError>> => {
  const user = await AuthManager.getUserFromPublicId(publicId)
  const account = await AccountsUseCases.getOrCreateAccount(user)

  // Enforce per-user purchased-credit cap before inserting the new row.
  const current = await purchasedCreditsRepository.getRemainingCredits(account.id)
  const newUploadTotal = current.uploadBytesRemaining + credits
  const newDownloadTotal = current.downloadBytesRemaining + credits

  if (
    newUploadTotal > config.credits.maxBytesPerUser ||
    newDownloadTotal > config.credits.maxBytesPerUser
  ) {
    logger.warn(
      'Purchase would exceed per-user cap (accountId=%s, currentUpload=%d, currentDownload=%d, adding=%d, cap=%d)',
      account.id,
      current.uploadBytesRemaining,
      current.downloadBytesRemaining,
      credits,
      config.credits.maxBytesPerUser,
    )
    return err(new ForbiddenError('Purchase would exceed per-user credit cap'))
  }

  const expiresAt = new Date(
    Date.now() + config.credits.expiryDays * 24 * 60 * 60 * 1000,
  )

  await purchasedCreditsRepository.createPurchasedCredit({
    accountId: account.id,
    intentId,
    uploadBytesOriginal: credits,
    downloadBytesOriginal: credits,
    expiresAt,
  })

  logger.info(
    'Purchased credits created (accountId=%s, intentId=%s, bytes=%d, expiresAt=%s)',
    account.id,
    intentId,
    credits,
    expiresAt.toISOString(),
  )

  return ok()
}

const getTopAccounts = async (
  user: User,
  {
    fromDate,
    toDate,
    limit = 10,
    type = 'upload',
  }: {
    limit: number | undefined
    fromDate: Date | null
    toDate: Date | null
    type?: 'upload' | 'download'
  },
): Promise<Result<AccountWithTotalSize[], ForbiddenError>> => {
  if (user.role !== UserRole.Admin) {
    logger.warn('User does not have admin privileges', {
      userPublicId: user.publicId,
    })
    return err(new ForbiddenError('User does not have admin privileges'))
  }
  const interactionType =
    type === 'download' ? InteractionType.Download : InteractionType.Upload
  return ok(
    await accountsRepository.getTopAccountsWithinPeriod(
      interactionType,
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
