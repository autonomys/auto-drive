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
  AccountInfoWithUser,
  AccountWithTotalSize,
  AdminAccountDetails,
  Intent,
  AccountTermsChange,
} from '@auto-drive/models'
import { accountsRepository } from '../../infrastructure/repositories/users/accounts.js'
import { interactionsRepository } from '../../infrastructure/repositories/objects/interactions.js'
import { purchasedCreditsRepository } from '../../infrastructure/repositories/users/purchasedCredits.js'
import { InteractionsUseCases } from '../objects/interactions.js'
import { AuthManager } from '../../infrastructure/services/auth/index.js'
import { getDatabase } from '../../infrastructure/drivers/pg.js'
import { config } from '../../config.js'
import { err, ok, Result } from 'neverthrow'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  ObjectNotFoundError,
  PaymentRequiredError,
} from '../../errors/index.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('AccountsUseCases')

/**
 * The holding cap and expiry period that apply to an account: its overrides,
 * or the global defaults where it has none.
 */
const getCreditTerms = (
  account: Pick<Account, 'maxPurchasedBytes' | 'creditExpiryDays'>,
): { maxBytes: bigint; expiryDays: number } => ({
  maxBytes:
    typeof account.maxPurchasedBytes === 'number'
      ? BigInt(account.maxPurchasedBytes)
      : config.credits.maxBytesPerAccount,
  expiryDays: account.creditExpiryDays ?? config.credits.expiryDays,
})

// A credit term left undefined stays as it is; null clears the override.
const updateAccount = async (
  executor: User,
  accountId: string,
  model: AccountModel,
  uploadLimit: number,
  downloadLimit: number,
  terms: {
    maxPurchasedBytes?: number | null
    creditExpiryDays?: number | null
    reason?: string
  } = {},
): Promise<
  Result<void, ForbiddenError | ObjectNotFoundError | BadRequestError>
> => {
  if (executor.role !== UserRole.Admin) {
    logger.warn('User does not have admin privileges', {
      accountId,
      model,
      uploadLimit,
      downloadLimit,
    })
    return err(new ForbiddenError('User does not have admin privileges'))
  }

  const account = await accountsRepository.getById(accountId)
  if (!account) {
    logger.warn('Account not found', {
      accountId,
      model,
      uploadLimit,
      downloadLimit,
    })
    return err(new ObjectNotFoundError('Account not found'))
  }

  // A partner account's uploads are paid with purchased credits only.
  if (account.isPartner && uploadLimit !== 0) {
    return err(
      new BadRequestError(
        'A partner account has no free upload allowance: its upload limit must be 0',
      ),
    )
  }

  logger.debug('Updating account', {
    accountId,
    model,
    uploadLimit,
    downloadLimit,
  })

  await accountsRepository.updateAccount(
    account.id,
    {
      model,
      uploadLimit,
      downloadLimit,
      maxPurchasedBytes:
        terms.maxPurchasedBytes === undefined
          ? account.maxPurchasedBytes
          : terms.maxPurchasedBytes,
      creditExpiryDays:
        terms.creditExpiryDays === undefined
          ? account.creditExpiryDays
          : terms.creditExpiryDays,
    },
    executor.publicId,
    terms.reason,
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
  // Returns the existing account if the organisation already has one.
  return accountsRepository.createAccount(
    v4(),
    organizationId,
    config.params.defaultAccount.model as AccountModel,
    uploadLimit,
    downloadLimit,
  )
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

  // For uploads, also include any active purchased credits so the upload gate
  // (pendingCredits < metadata.totalSize) grants access when the user has
  // enough purchased bytes, even if their free allocation is exhausted.
  //
  // Downloads use only their free-tier budget. Purchased download bytes are
  // not allocated on purchase and are not counted here.
  //
  // getRemainingCredits is a plain DB query with no awareness of the
  // buyCredits feature flag. If the flag is OFF and no rows exist in
  // purchased_credits (because the /intents routes are gated), this returns
  // zero and behaviour is identical to the pre-purchased-credits state.
  // If credits were purchased while the flag was ON and it is later turned
  // OFF, those already-purchased credits remain visible and usable — this is
  // intentional: users should not lose credits they already paid for.
  if (type === InteractionType.Upload) {
    const purchased = await purchasedCreditsRepository.getRemainingCredits(
      account.id,
    )
    // A free allowance spent beyond its limit (the limit was lowered after the
    // uploads) counts as zero, as in registerInteraction, so it can't hide
    // purchased bytes from the upload gate.
    return Math.max(0, freeRemaining) + Number(purchased.uploadBytesRemaining)
  }

  return freeRemaining
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

// Members of an organisation share its account, so it is looked up once per
// organisation.
const getAccountInfosByOrganization = async (
  users: UserWithOrganization[],
): Promise<Map<string, AccountInfo>> => {
  const byOrganization = new Map<string, UserWithOrganization>()
  for (const user of users) {
    if (user.organizationId && !byOrganization.has(user.organizationId)) {
      byOrganization.set(user.organizationId, user)
    }
  }

  return new Map(
    await Promise.all(
      [...byOrganization].map(
        async ([organizationId, user]) =>
          [organizationId, await getAccountInfo(user)] as const,
      ),
    ),
  )
}

const getUserListAccount = async (
  executor: User,
  userPublicIds: string[],
): Promise<Result<Record<string, AccountInfo>, ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('User does not have admin privileges'))
  }

  if (userPublicIds.length === 0) return ok({})

  const users = await AuthManager.getUsersFromPublicIds(userPublicIds)
  const accountInfos = await getAccountInfosByOrganization(users)

  // In request order: auth returns users unordered, and the admin panel lists
  // a page in the order of this response.
  const usersByPublicId = new Map(users.map((u) => [u.publicId, u]))
  return ok(
    Object.fromEntries(
      userPublicIds.flatMap((publicId) => {
        const organizationId = usersByPublicId.get(publicId)?.organizationId
        const info = organizationId && accountInfos.get(organizationId)
        return info ? [[publicId, info]] : []
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
  cid?: string,
): Promise<void> => {
  const account = await getOrCreateAccount(user)
  const creditType = type === InteractionType.Upload ? 'upload' : 'download'

  logger.debug(
    'Registering interaction (accountId=%s, type=%s, size=%d)',
    account.id,
    type,
    size,
  )

  // One transaction for the whole interaction: drawing down purchased batches,
  // the free-tier guard, and writing the interactions with their per-batch
  // consumption rows. Any failure rolls all of it back, so the ledger never
  // disagrees with the balances and nothing needs a compensating refund.
  const db = await getDatabase()
  const client = await db.connect()
  try {
    await client.query('BEGIN')

    // consumeUpTo locks the account's purchased rows until commit, which
    // serialises concurrent uploads against the purchased pool.
    //
    // Downloads use only the free-tier guard below. Purchased download bytes
    // are not allocated on purchase or consumed here.
    const consumed =
      type === InteractionType.Upload
        ? await purchasedCreditsRepository.consumeUpTo(
            client,
            account.id,
            creditType,
            size,
          )
        : []
    const fromPurchased = consumed.reduce((acc, c) => acc + c.bytes, BigInt(0))
    const fromFree = size - fromPurchased

    // Guard: a request that only received a partial purchased allocation must
    // not silently overflow into free-tier credits it does not own.
    if (fromFree > BigInt(0)) {
      const end = new Date()
      const start =
        account.model === AccountModel.Monthly
          ? new Date(end.getFullYear(), end.getMonth(), 1, 0, 0, 0, 0)
          : new Date(0)

      const freeTierInteractions =
        await interactionsRepository.getInteractionsByAccountIdAndTypeInTimeRange(
          account.id,
          type,
          start,
          end,
          InteractionSource.FreeTier,
          client,
        )

      const spentFree = freeTierInteractions.reduce(
        (acc, i) => acc + BigInt(i.size),
        BigInt(0),
      )
      const freeLimit = BigInt(
        type === InteractionType.Upload
          ? account.uploadLimit
          : account.downloadLimit,
      )
      const freeAvailable =
        freeLimit > spentFree ? freeLimit - spentFree : BigInt(0)

      if (fromFree > freeAvailable) {
        logger.warn(
          'registerInteraction: insufficient free-tier credits — rejecting (accountId=%s, fromFree=%d, freeAvailable=%d)',
          account.id,
          fromFree,
          freeAvailable,
        )
        throw new PaymentRequiredError(
          `Insufficient credits to process ${creditType}`,
        )
      }
    }

    if (fromPurchased > BigInt(0)) {
      const interactionId = await InteractionsUseCases.createInteraction(
        account.id,
        type,
        fromPurchased,
        InteractionSource.Purchased,
        cid,
        user.apiKeyId,
        client,
      )
      await interactionsRepository.createCreditConsumption(
        interactionId,
        consumed,
        client,
      )
    }

    if (fromFree > BigInt(0)) {
      logger.debug(
        'Covering remainder from free-tier (accountId=%s, fromPurchased=%d, fromFree=%d)',
        account.id,
        fromPurchased,
        fromFree,
      )

      await InteractionsUseCases.createInteraction(
        account.id,
        type,
        fromFree,
        InteractionSource.FreeTier,
        cid,
        user.apiKeyId,
        client,
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const addCreditsToAccount = async (
  intent: Pick<Intent, 'id' | 'userPublicId' | 'accountId'>,
  credits: bigint,
): Promise<Result<void, ForbiddenError | ConflictError>> => {
  // Intents created before account_id was recorded go to the buyer's current
  // account.
  const account =
    (intent.accountId &&
      (await accountsRepository.getById(intent.accountId))) ||
    (await AccountsUseCases.getOrCreateAccount(
      await AuthManager.getUserFromPublicId(intent.userPublicId),
    ))
  const accountId = account.id
  const terms = getCreditTerms(account)

  const expiresAt = new Date(
    Date.now() + terms.expiryDays * 24 * 60 * 60 * 1000,
  )

  // Atomically check the per-account cap, insert and complete the intent inside
  // a single transaction protected by a per-account advisory lock. This
  // prevents two concurrent onConfirmedIntent calls for different intents from
  // both passing the cap check and both inserting, which would push the account
  // over the cap.
  const result =
    await purchasedCreditsRepository.createPurchasedCreditWithCapCheck(
      {
        accountId,
        intentId: intent.id,
        uploadBytesOriginal: credits,
        // Download credits are not allocated on purchase — infrastructure is
        // kept for future use but download limits are not enforced right now.
        downloadBytesOriginal: 0n,
        expiresAt,
      },
      terms.maxBytes,
    )

  if (result.isErr()) {
    if (result.error === 'intent_not_confirmed') {
      return err(new ConflictError('Intent is no longer confirmed'))
    }
    logger.warn(
      'Purchase would exceed per-account cap (accountId=%s, adding=%d, cap=%d)',
      accountId,
      credits,
      terms.maxBytes,
    )
    return err(
      new ForbiddenError('Purchase would exceed per-account credit cap'),
    )
  }

  logger.info(
    'Purchased credits created (accountId=%s, intentId=%s, bytes=%d, expiresAt=%s)',
    accountId,
    intent.id,
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

/**
 * Admin lookup by any identifier an admin is likely to hold: a (partial) user
 * publicId, an account ID or an organization ID. An account ID is translated to
 * its organization so the auth service can return that organization's members.
 */
const adminSearchAccounts = async (
  executor: User,
  query: string,
): Promise<Result<AccountInfoWithUser[], ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('User does not have admin privileges'))
  }

  const account = await accountsRepository.getById(query)
  const users = await AuthManager.adminSearchUsers(
    query,
    account?.organizationId ?? query,
  )

  type MemberUser = UserWithOrganization & { organizationId: string }
  const onboarded = users.filter((u): u is MemberUser => !!u.organizationId)
  const accountInfos = await getAccountInfosByOrganization(onboarded)

  return ok(
    onboarded.map((user) => ({
      ...accountInfos.get(user.organizationId)!,
      user,
    })),
  )
}

/**
 * Admin account page: an account with its members. Members can be empty, e.g.
 * once the only member has deleted their user: the account and its credits
 * stay.
 */
const adminGetAccount = async (
  executor: User,
  accountId: string,
): Promise<
  Result<AdminAccountDetails, ForbiddenError | ObjectNotFoundError>
> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('User does not have admin privileges'))
  }

  const account = await accountsRepository.getById(accountId)
  if (!account) {
    return err(new ObjectNotFoundError('Account not found'))
  }

  return ok(await getAdminAccountDetails(account))
}

/** Admin: the account of an organization, as on the account page. */
const adminGetAccountByOrganization = async (
  executor: User,
  organizationId: string,
): Promise<
  Result<AdminAccountDetails, ForbiddenError | ObjectNotFoundError>
> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('User does not have admin privileges'))
  }

  const account = await accountsRepository.getByOrganizationId(organizationId)
  if (!account) {
    return err(new ObjectNotFoundError('Account not found'))
  }

  return ok(await getAdminAccountDetails(account))
}

const getAdminAccountDetails = async (
  account: Account,
): Promise<AdminAccountDetails> => {
  const [pendingUploadCredits, pendingDownloadCredits, users, organization] =
    await Promise.all([
      getPendingCreditsByAccountAndType(account, InteractionType.Upload),
      getPendingCreditsByAccountAndType(account, InteractionType.Download),
      AuthManager.adminSearchUsers('', account.organizationId),
      AuthManager.getOrganization(account.organizationId),
    ])

  return {
    ...account,
    pendingUploadCredits,
    pendingDownloadCredits,
    // Auth returns only this organization's members; `organizationId` is
    // null for unonboarded users, who are skipped.
    members: users.filter((u): u is UserWithOrganization => !!u.organizationId),
    organization: organization.unwrapOr(null),
    defaultCreditTerms: {
      maxPurchasedBytes: Number(config.credits.maxBytesPerAccount),
      creditExpiryDays: config.credits.expiryDays,
    },
  }
}

/** Admin: every change to an account's terms, newest first. */
const adminGetTermsChanges = async (
  executor: User,
  accountId: string,
): Promise<
  Result<AccountTermsChange[], ForbiddenError | ObjectNotFoundError>
> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('User does not have admin privileges'))
  }

  if (!(await accountsRepository.getById(accountId))) {
    return err(new ObjectNotFoundError('Account not found'))
  }

  return ok(await accountsRepository.getTermsChanges(accountId))
}

/**
 * Admin: each user's current account ID, keyed by publicId. Read-only, so
 * users without an organization or account are left out, not given one.
 */
const adminGetAccountIdsByUsers = async (
  executor: User,
  publicIds: string[],
): Promise<Result<Record<string, string>, ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('User does not have admin privileges'))
  }

  const users = await AuthManager.getUsersFromPublicIds(publicIds)
  const entries = await Promise.all(
    users.map(async ({ publicId, organizationId }) => {
      if (!publicId || !organizationId) return []
      const account =
        await accountsRepository.getByOrganizationId(organizationId)
      return account ? [[publicId, account.id] as const] : []
    }),
  )

  return ok(Object.fromEntries(entries.flat()))
}

export const AccountsUseCases = {
  adminSearchAccounts,
  adminGetAccount,
  adminGetAccountByOrganization,
  adminGetAccountIdsByUsers,
  adminGetTermsChanges,
  getCreditTerms,
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
