import {
  Account,
  AccountUsageSummary,
  PaymentMethod,
  UsageByApiKey,
  UsageByCustomerReference,
  UsageFreeCredit,
  UsageInteraction,
  UsagePurchase,
  UsageReport,
  User,
  UserRole,
  UserWithOrganization,
  SERVICE_USER_PROVIDER,
  deriveUserPublicId,
} from '@auto-drive/models'
import { err, ok, Result } from 'neverthrow'
import { formatUnits } from 'viem'
import { config } from '../../config.js'
import {
  BadRequestError,
  ForbiddenError,
  ObjectNotFoundError,
} from '../../errors/index.js'
import { AuthManager } from '../../infrastructure/services/auth/index.js'
import { accountsRepository } from '../../infrastructure/repositories/users/accounts.js'
import {
  FreeCreditRow,
  InteractionGroup,
  InteractionRow,
  PurchaseRow,
  usageReportsRepository,
} from '../../infrastructure/repositories/users/usageReports.js'
import { AI3_DECIMALS, USDC_DECIMALS } from '../../shared/utils/pricing.js'
import { CsvValue, csvRow, toCsv } from '../../shared/utils/csv.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('core:users:usageReports')

export type ReportRange = { from: Date; to: Date }

const INTERACTIONS_PAGE_SIZE = 5000

// A range ending in the future is cut at now: what has not happened yet is not
// reported, and a future expiry must not count as one.
const resolveRange = ({
  from,
  to,
}: ReportRange): Result<ReportRange, BadRequestError> => {
  const now = new Date()
  const end = to < now ? to : now
  if (from >= end) {
    return err(
      new BadRequestError('`from` must be in the past and before `to`'),
    )
  }
  return ok({ from, to: end })
}

// Members of the account's organisation can read its reports, and Auto Drive
// admins can read any account's.
const getReadableAccount = async (
  executor: UserWithOrganization,
  accountId: string,
): Promise<Result<Account, ForbiddenError | ObjectNotFoundError>> => {
  if (executor.role === UserRole.Admin) {
    const account = await accountsRepository.getById(accountId)
    return account
      ? ok(account)
      : err(new ObjectNotFoundError('Account not found'))
  }

  const own = executor.organizationId
    ? await accountsRepository.getByOrganizationId(executor.organizationId)
    : null
  return own?.id === accountId
    ? ok(own)
    : err(new ForbiddenError('Not a member of this account'))
}

const sum = (values: string[]): string =>
  values.reduce((total, value) => total + BigInt(value), BigInt(0)).toString()

// Bytes paid with purchased credits and with free credits, never summed
// together. Purchased bytes include those from before attribution, whose
// batches are unknown.
const splitUploads = (uploads: InteractionGroup[]) => ({
  purchasedBytes: sum(
    uploads.filter((g) => g.source === 'purchased').map((g) => g.bytes),
  ),
  freeCreditBytes: sum(
    uploads.filter((g) => g.source === 'free_credits').map((g) => g.bytes),
  ),
})

// Names come from auth and are a convenience: when it can't give them, the
// report goes without them rather than failing.
const namesOrNone = async <T>(
  what: string,
  lookup: () => Promise<T[]>,
): Promise<T[]> => {
  try {
    return await lookup()
  } catch (error) {
    logger.warn(error, `Usage report without ${what}`)
    return []
  }
}

type KeyName = {
  name: string | null
  deleted: boolean
  owner: UsageByApiKey['owner']
  ownerName: string | null
}

// A key belongs to the organisation when its service user owns it, else to
// the member who made it, named by their username unless `ownerNames` is off.
const getKeyNames = async (
  ids: string[],
  { ownerNames = true }: { ownerNames?: boolean } = {},
): Promise<Map<string, KeyName>> => {
  const keys = await namesOrNone('API key names', () =>
    AuthManager.getApiKeyNames([...new Set(ids)]),
  )
  const memberPublicIds = new Map(
    keys.flatMap((key) =>
      key.oauthProvider &&
      key.oauthUserId &&
      key.oauthProvider !== SERVICE_USER_PROVIDER
        ? [[key.id, deriveUserPublicId(key.oauthProvider, key.oauthUserId)]]
        : [],
    ),
  )
  const users = ownerNames
    ? await namesOrNone('API key owners', () =>
        AuthManager.getUsersFromPublicIds([
          ...new Set(memberPublicIds.values()),
        ]),
      )
    : []
  const usernames = new Map(
    users.map((user) => [user.publicId, user.oauthUsername ?? null]),
  )

  return new Map(
    keys.map((key) => {
      const ownerPublicId = memberPublicIds.get(key.id)
      const owner: KeyName['owner'] = !key.oauthProvider
        ? null
        : key.oauthProvider === SERVICE_USER_PROVIDER
          ? 'organization'
          : 'member'
      return [
        key.id,
        {
          name: key.name,
          deleted: !!key.deletedAt,
          owner,
          ownerName: ownerPublicId
            ? (usernames.get(ownerPublicId) ?? null)
            : null,
        },
      ]
    }),
  )
}

// Without a key, an interaction is from a browser session if it was made after
// attribution started, and unknown before.
const kindOf = (group: InteractionGroup): UsageByApiKey['kind'] => {
  if (group.apiKeyId) return 'apiKey'
  return group.afterAttributionStart ? 'session' : 'unattributed'
}

const byApiKey = async (
  groups: InteractionGroup[],
): Promise<UsageByApiKey[]> => {
  const names = await getKeyNames(
    groups.flatMap((g) => (g.apiKeyId ? [g.apiKeyId] : [])),
  )

  const buckets = new Map<string, InteractionGroup[]>()
  for (const group of groups) {
    const key = group.apiKeyId ?? kindOf(group)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(group)
    else buckets.set(key, [group])
  }

  const rows = [...buckets.values()].map((bucket): UsageByApiKey => {
    const uploads = bucket.filter((g) => g.type === 'upload')
    const downloads = bucket.filter((g) => g.type === 'download')
    const { apiKeyId } = bucket[0]
    const key = apiKeyId ? names.get(apiKeyId) : undefined
    return {
      kind: kindOf(bucket[0]),
      apiKeyId,
      name: key?.name ?? null,
      owner: key?.owner ?? null,
      ownerName: key?.ownerName ?? null,
      deleted: key?.deleted ?? false,
      uploadCount: uploads.reduce((total, g) => total + g.count, 0),
      uploadBytes: sum(uploads.map((g) => g.bytes)),
      ...splitUploads(uploads),
      ai3Value: sum(uploads.map((g) => g.value)),
      downloadCount: downloads.reduce((total, g) => total + g.count, 0),
      downloadBytes: sum(downloads.map((g) => g.bytes)),
    }
  })

  // Keys first, then sessions and unattributed usage; most upload bytes first
  // within each.
  const rank = { apiKey: 0, session: 1, unattributed: 2 }
  return rows.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      Number(BigInt(b.uploadBytes) - BigInt(a.uploadBytes)) ||
      (a.apiKeyId ?? '').localeCompare(b.apiKeyId ?? ''),
  )
}

// Uploads only: a download is not made for a customer reference.
const byCustomerReference = (
  groups: InteractionGroup[],
): UsageByCustomerReference[] => {
  const buckets = new Map<string | null, InteractionGroup[]>()
  for (const group of groups) {
    if (group.type !== 'upload') continue
    const key = group.customerReference
    const bucket = buckets.get(key)
    if (bucket) bucket.push(group)
    else buckets.set(key, [group])
  }

  const rows = [...buckets].map(
    ([customerReference, bucket]): UsageByCustomerReference => ({
      customerReference,
      uploadCount: bucket.reduce((total, g) => total + g.count, 0),
      uploadBytes: sum(bucket.map((g) => g.bytes)),
      ...splitUploads(bucket),
      ai3Value: sum(bucket.map((g) => g.value)),
    }),
  )

  // References first, most upload bytes first; uploads without one last.
  return rows.sort(
    (a, b) =>
      Number(a.customerReference === null) -
        Number(b.customerReference === null) ||
      Number(BigInt(b.uploadBytes) - BigInt(a.uploadBytes)) ||
      (a.customerReference ?? '').localeCompare(b.customerReference ?? ''),
  )
}

const toPurchase = (row: PurchaseRow): UsagePurchase => ({
  batchId: row.batch_id,
  intentId: row.intent_id,
  buyer: row.user_public_id,
  grantedAt: row.purchased_at.toISOString(),
  paymentMethod: row.payment_method,
  paymentAmount: row.payment_amount,
  tokenAmount: row.token_amount,
  quotedTokenAmount: row.quoted_token_amount,
  quotedAi3Shannons: row.quoted_ai3_shannons,
  shannonsPerByte: row.shannons_per_byte,
  bytes: row.upload_bytes_original,
  expiresAt: row.expires_at.toISOString(),
  txHash: row.tx_hash,
  fromAddress: row.from_address,
  refundedAt: row.refunded_at?.toISOString() ?? null,
  refundTxHash: row.refund_tx_hash,
  refundedBytes: row.refunded_upload_bytes,
})

// Who granted free credits, and why, is for admins only.
const toFreeCredit = (row: FreeCreditRow, admin: boolean): UsageFreeCredit => ({
  batchId: row.batch_id,
  kind: row.kind,
  grantedAt: row.purchased_at.toISOString(),
  period: row.grant_period,
  bytes: row.upload_bytes_original,
  expiresAt: row.expires_at.toISOString(),
  ...(admin && { grantedBy: row.granted_by, reason: row.grant_reason }),
})

const getUsageReport = async (
  executor: UserWithOrganization,
  accountId: string,
  range: ReportRange,
): Promise<
  Result<UsageReport, BadRequestError | ForbiddenError | ObjectNotFoundError>
> => {
  const account = await getReadableAccount(executor, accountId)
  if (account.isErr()) return err(account.error)
  const resolved = resolveRange(range)
  if (resolved.isErr()) return err(resolved.error)

  const { from, to } = resolved.value
  const { attributionStart } = config.usageReports
  const balanced = attributionStart && from >= attributionStart
  const [groups, purchases, freeCredits, balance, freeCreditBalance] =
    await Promise.all([
      usageReportsRepository.getInteractionGroups(
        accountId,
        from,
        to,
        attributionStart,
      ),
      usageReportsRepository.getPurchases(accountId, from, to),
      usageReportsRepository.getFreeCredits(accountId, from, to),
      balanced
        ? usageReportsRepository.getBalance(accountId, from, to, false)
        : null,
      balanced
        ? usageReportsRepository.getBalance(accountId, from, to, true)
        : null,
    ])

  const uploads = groups.filter((g) => g.type === 'upload')
  const purchased = uploads.filter((g) => g.source === 'purchased')
  const downloads = groups.filter((g) => g.type === 'download')

  return ok({
    accountId,
    from: from.toISOString(),
    to: to.toISOString(),
    attributionStart: attributionStart?.toISOString() ?? null,
    uploads: {
      count: uploads.reduce((total, g) => total + g.count, 0),
      bytes: sum(uploads.map((g) => g.bytes)),
      freeTierBytes: sum(
        uploads.filter((g) => g.source === 'free_tier').map((g) => g.bytes),
      ),
      ...splitUploads(uploads),
      unattributedBytes: (
        BigInt(sum(purchased.map((g) => g.bytes))) -
        BigInt(sum(purchased.map((g) => g.valuedBytes)))
      ).toString(),
      ai3Value: sum(uploads.map((g) => g.value)),
    },
    downloads: {
      count: downloads.reduce((total, g) => total + g.count, 0),
      bytes: sum(downloads.map((g) => g.bytes)),
    },
    apiKeys: await byApiKey(groups),
    customerReferences: byCustomerReference(groups),
    purchases: purchases.map(toPurchase),
    freeCredits: freeCredits.map((row) =>
      toFreeCredit(row, executor.role === UserRole.Admin),
    ),
    balance,
    freeCreditBalance,
  })
}

/**
 * The account's interactions in the range, in time order, as pages read one at
 * a time so an export of any size is never held in memory.
 */
const getUsageInteractions = async (
  executor: UserWithOrganization,
  accountId: string,
  range: ReportRange,
): Promise<
  Result<
    ReportRange & { pages: AsyncGenerator<UsageInteraction[]> },
    BadRequestError | ForbiddenError | ObjectNotFoundError
  >
> => {
  const account = await getReadableAccount(executor, accountId)
  if (account.isErr()) return err(account.error)
  const resolved = resolveRange(range)
  if (resolved.isErr()) return err(resolved.error)

  const { from, to } = resolved.value
  async function* pages() {
    const names = new Map<string, string | null>()
    let after: InteractionRow | null = null
    for (;;) {
      const rows = await usageReportsRepository.getInteractionsPage(
        accountId,
        from,
        to,
        after,
        INTERACTIONS_PAGE_SIZE,
      )
      if (rows.length === 0) return

      const unnamed = rows.flatMap((r) =>
        r.api_key_id && !names.has(r.api_key_id) ? [r.api_key_id] : [],
      )
      const found = await getKeyNames(unnamed, { ownerNames: false })
      for (const id of unnamed) names.set(id, found.get(id)?.name ?? null)

      yield rows.map(
        (row): UsageInteraction => ({
          id: row.id,
          createdAt: row.created_at.toISOString(),
          type: row.type,
          source: row.source,
          bytes: row.size,
          cid: row.cid,
          apiKeyId: row.api_key_id,
          apiKeyName: row.api_key_id ? names.get(row.api_key_id)! : null,
          customerReference: row.customer_reference,
          ai3Value: row.value,
        }),
      )

      if (rows.length < INTERACTIONS_PAGE_SIZE) return
      after = rows[rows.length - 1]
    }
  }

  return ok({ from, to, pages: pages() })
}

const adminGetAccountUsageSummaries = async (
  executor: User,
  range: ReportRange,
  { partnersOnly, limit }: { partnersOnly: boolean; limit: number },
): Promise<Result<AccountUsageSummary[], BadRequestError | ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('User does not have admin privileges'))
  }
  const resolved = resolveRange(range)
  if (resolved.isErr()) return err(resolved.error)

  const rows = await usageReportsRepository.getAccountSummaries(
    resolved.value.from,
    resolved.value.to,
    partnersOnly,
    limit,
  )

  const organizationIds = [...new Set(rows.map((r) => r.organization_id))]
  const names = new Map<string, string>()
  for (let i = 0; i < organizationIds.length; i += 100) {
    const summaries = await namesOrNone('organization names', async () =>
      (
        await AuthManager.getOrganizationSummaries(
          organizationIds.slice(i, i + 100),
        )
      ).unwrapOr([]),
    )
    for (const { id, name } of summaries) names.set(id, name)
  }

  return ok(
    rows.map((row) => ({
      accountId: row.account_id,
      organizationId: row.organization_id,
      organizationName: names.get(row.organization_id) ?? null,
      isPartner: row.is_partner,
      uploadCount: Number(row.upload_count),
      uploadBytes: row.upload_bytes,
      ai3Value: row.ai3_value,
      freeCreditBytes: row.free_credit_bytes,
      downloadBytes: row.download_bytes,
      grantedBytes: row.granted_bytes,
      freeCreditsGrantedBytes: row.free_credits_granted_bytes,
    })),
  )
}

// CSV exports: the same figures as the JSON report. Amounts are given as
// decimals in AI3 and USDC, which is how they are read in a spreadsheet.

const ai3 = (shannons: string | null) =>
  shannons === null ? null : formatUnits(BigInt(shannons), AI3_DECIMALS)
const usdc = (baseUnits: string | null) =>
  baseUnits === null ? null : formatUnits(BigInt(baseUnits), USDC_DECIMALS)

// USDC per AI3 that a USDC purchase was charged at, to 6 decimals.
const usdcPerAi3 = (purchase: UsagePurchase) =>
  purchase.quotedTokenAmount && purchase.quotedAi3Shannons
    ? usdc(
        (
          (BigInt(purchase.quotedTokenAmount) *
            BigInt(10) ** BigInt(AI3_DECIMALS)) /
          BigInt(purchase.quotedAi3Shannons)
        ).toString(),
      )
    : null

export const USAGE_REPORT_TABLES = [
  'summary',
  'apiKeys',
  'customerReferences',
  'purchases',
  'freeCredits',
] as const
export type UsageReportTable = (typeof USAGE_REPORT_TABLES)[number]

const usageReportCsv = (report: UsageReport, table: UsageReportTable) => {
  switch (table) {
    case 'summary': {
      const { uploads, downloads, balance, freeCreditBalance } = report
      const rows: [string, CsvValue][] = [
        ['account_id', report.accountId],
        ['from', report.from],
        ['to', report.to],
        ['attribution_start', report.attributionStart],
        ['upload_count', uploads.count],
        ['upload_bytes', uploads.bytes],
        ['free_tier_upload_bytes', uploads.freeTierBytes],
        ['purchased_upload_bytes', uploads.purchasedBytes],
        ['free_credit_upload_bytes', uploads.freeCreditBytes],
        ['unattributed_upload_bytes', uploads.unattributedBytes],
        ['ai3_value', ai3(uploads.ai3Value)],
        ['download_count', downloads.count],
        ['download_bytes', downloads.bytes],
        ['purchased_opening_balance_bytes', balance?.opening],
        ['purchased_granted_bytes', balance?.granted],
        ['purchased_consumed_bytes', balance?.consumed],
        ['purchased_expired_bytes', balance?.expired],
        ['purchased_refunded_bytes', balance?.refunded],
        ['purchased_closing_balance_bytes', balance?.closing],
        ['free_credit_opening_balance_bytes', freeCreditBalance?.opening],
        ['free_credit_granted_bytes', freeCreditBalance?.granted],
        ['free_credit_consumed_bytes', freeCreditBalance?.consumed],
        ['free_credit_expired_bytes', freeCreditBalance?.expired],
        ['free_credit_closing_balance_bytes', freeCreditBalance?.closing],
      ]
      return toCsv(['metric', 'value'], rows)
    }
    case 'apiKeys':
      return toCsv(
        [
          'kind',
          'api_key_id',
          'name',
          'deleted',
          'upload_count',
          'upload_bytes',
          'purchased_upload_bytes',
          'free_credit_upload_bytes',
          'ai3_value',
          'download_count',
          'download_bytes',
          'owner',
          'owner_name',
        ],
        report.apiKeys.map((key) => [
          key.kind,
          key.apiKeyId,
          key.name,
          key.deleted,
          key.uploadCount,
          key.uploadBytes,
          key.purchasedBytes,
          key.freeCreditBytes,
          ai3(key.ai3Value),
          key.downloadCount,
          key.downloadBytes,
          key.owner,
          key.ownerName,
        ]),
      )
    case 'customerReferences':
      return toCsv(
        [
          'customer_reference',
          'upload_count',
          'upload_bytes',
          'purchased_upload_bytes',
          'free_credit_upload_bytes',
          'ai3_value',
        ],
        report.customerReferences.map((row) => [
          row.customerReference,
          row.uploadCount,
          row.uploadBytes,
          row.purchasedBytes,
          row.freeCreditBytes,
          ai3(row.ai3Value),
        ]),
      )
    case 'purchases':
      return toCsv(
        [
          'batch_id',
          'intent_id',
          'buyer',
          'granted_at',
          'payment_method',
          'amount_paid',
          'usdc_per_ai3',
          'shannons_per_byte',
          'bytes',
          'expires_at',
          'tx_hash',
          'from_address',
          'refunded_at',
          'refund_tx_hash',
          'refunded_bytes',
        ],
        report.purchases.map((purchase) => [
          purchase.batchId,
          purchase.intentId,
          purchase.buyer,
          purchase.grantedAt,
          purchase.paymentMethod,
          purchase.paymentMethod === PaymentMethod.USDC_ETH
            ? usdc(purchase.tokenAmount)
            : ai3(purchase.paymentAmount),
          usdcPerAi3(purchase),
          purchase.shannonsPerByte,
          purchase.bytes,
          purchase.expiresAt,
          purchase.txHash,
          purchase.fromAddress,
          purchase.refundedAt,
          purchase.refundTxHash,
          purchase.refundedBytes,
        ]),
      )
    case 'freeCredits':
      return toCsv(
        [
          'batch_id',
          'kind',
          'granted_at',
          'period',
          'bytes',
          'expires_at',
          'granted_by',
          'reason',
        ],
        report.freeCredits.map((credit) => [
          credit.batchId,
          credit.kind,
          credit.grantedAt,
          credit.period,
          credit.bytes,
          credit.expiresAt,
          credit.grantedBy,
          credit.reason,
        ]),
      )
  }
}

export const USAGE_INTERACTIONS_CSV_HEADER = csvRow([
  'id',
  'created_at',
  'type',
  'source',
  'bytes',
  'cid',
  'api_key_id',
  'api_key_name',
  'customer_reference',
  'ai3_value',
])

const usageInteractionsCsv = (interactions: UsageInteraction[]) =>
  interactions
    .map((i) =>
      csvRow([
        i.id,
        i.createdAt,
        i.type,
        i.source,
        i.bytes,
        i.cid,
        i.apiKeyId,
        i.apiKeyName,
        i.customerReference,
        ai3(i.ai3Value),
      ]),
    )
    .join('')

export const UsageReportsUseCases = {
  getUsageReport,
  getUsageInteractions,
  adminGetAccountUsageSummaries,
  usageReportCsv,
  usageInteractionsCsv,
}
