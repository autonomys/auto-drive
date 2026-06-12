import { jest } from '@jest/globals'
import { CreditsUseCases } from '../../../src/core/users/credits.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../src/errors/index.js'
import {
  type Account,
  type PurchasedCredit,
  type User,
  type UserWithOrganization,
  UserRole,
} from '@auto-drive/models'
import { config } from '../../../src/config.js'

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const now = new Date()

const baseUser: UserWithOrganization = {
  id: 'user-id',
  publicId: 'pub-1',
  walletAddress: '0xabc',
  createdAt: now,
  updatedAt: now,
  authProvider: 'google',
  oauthProvider: 'google',
  oauthUsername: 'test@gmail.com',
  organizationId: 'org-1',
  role: UserRole.User,
} as unknown as UserWithOrganization

const adminUser: User = {
  ...baseUser,
  role: UserRole.Admin,
} as unknown as User

const nonAdminUser: User = {
  ...baseUser,
  role: UserRole.User,
} as unknown as User

const mockAccount: Account = {
  id: 'account-id',
  organizationId: 'org-1',
  model: 'monthly',
  uploadLimit: 100,
  downloadLimit: 100,
} as unknown as Account

const FUTURE_EXPIRY = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const SOON_EXPIRY = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

const makeCreditRow = (
  overrides: Partial<PurchasedCredit> = {},
): PurchasedCredit => ({
  id: 'credit-1',
  accountId: 'account-id',
  intentId: 'intent-1',
  uploadBytesOriginal: BigInt(1024 * 1024 * 1024), // 1 GiB
  uploadBytesRemaining: BigInt(1024 * 1024 * 1024),
  downloadBytesOriginal: BigInt(1024 * 1024 * 1024),
  downloadBytesRemaining: BigInt(1024 * 1024 * 1024),
  purchasedAt: now,
  expiresAt: FUTURE_EXPIRY,
  expired: false,
  refundedAt: null,
  refundTxHash: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('CreditsUseCases', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest
      .spyOn(AccountsUseCases, 'getOrCreateAccount')
      .mockResolvedValue(mockAccount)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // getSummary
  // ──────────────────────────────────────────────────────────────────────────

  describe('getSummary', () => {
    it('returns zeros and canPurchase=true when no credits exist', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({
          uploadBytesRemaining: 0n,
          uploadBytesOriginal: 0n,
          downloadBytesRemaining: 0n,
          nextExpiryDate: null,
          activeRowCount: 0,
        })

      const summary = await CreditsUseCases.getSummary(baseUser)

      expect(summary.uploadBytesRemaining).toBe(0n)
      expect(summary.totalPurchasedBytesOriginal).toBe(0n)
      expect(summary.downloadBytesRemaining).toBe(0n)
      expect(summary.nextExpiryDate).toBeNull()
      expect(summary.batchCount).toBe(0)
      expect(summary.canPurchase).toBe(true)
      expect(summary.maxPurchasableBytes).toBe(config.credits.maxBytesPerUser)
    })

    it('returns googleVerified=true for Google-authed user', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({
          uploadBytesRemaining: 0n,
          uploadBytesOriginal: 0n,
          downloadBytesRemaining: 0n,
          nextExpiryDate: null,
          activeRowCount: 0,
        })

      const summary = await CreditsUseCases.getSummary(baseUser)
      expect(summary.googleVerified).toBe(true)
    })

    it('returns googleVerified=false for non-Google user', async () => {
      const githubUser: UserWithOrganization = {
        ...baseUser,
        oauthProvider: 'github',
      } as unknown as UserWithOrganization

      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({
          uploadBytesRemaining: 0n,
          uploadBytesOriginal: 0n,
          downloadBytesRemaining: 0n,
          nextExpiryDate: null,
          activeRowCount: 0,
        })

      const summary = await CreditsUseCases.getSummary(githubUser)
      expect(summary.googleVerified).toBe(false)
    })

    it('computes maxPurchasableBytes using the larger of upload/download remaining', async () => {
      // Upload has 80 GiB remaining, download has 50 GiB
      // Binding constraint is upload (80 GiB), so room = cap - 80 GiB
      const uploadRemaining = BigInt(80 * 1024 ** 3)
      const downloadRemaining = BigInt(50 * 1024 ** 3)
      const cap = config.credits.maxBytesPerUser // 100 GiB

      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({
          uploadBytesRemaining: uploadRemaining,
          uploadBytesOriginal: BigInt(100 * 1024 ** 3),
          downloadBytesRemaining: downloadRemaining,
          nextExpiryDate: FUTURE_EXPIRY,
          activeRowCount: 2,
        })

      const summary = await CreditsUseCases.getSummary(baseUser)

      expect(summary.maxPurchasableBytes).toBe(cap - uploadRemaining)
      expect(summary.canPurchase).toBe(true)
    })

    it('returns canPurchase=false and maxPurchasableBytes=0n when at or over cap', async () => {
      const cap = config.credits.maxBytesPerUser

      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({
          uploadBytesRemaining: cap,
          uploadBytesOriginal: cap,
          downloadBytesRemaining: cap,
          nextExpiryDate: FUTURE_EXPIRY,
          activeRowCount: 1,
        })

      const summary = await CreditsUseCases.getSummary(baseUser)

      expect(summary.canPurchase).toBe(false)
      expect(summary.maxPurchasableBytes).toBe(0n)
    })

    it('uses upload bytes only for cap even when download remaining is higher', async () => {
      const uploadRemaining = BigInt(30 * 1024 ** 3)
      const downloadRemaining = BigInt(70 * 1024 ** 3)
      const cap = config.credits.maxBytesPerUser

      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({
          uploadBytesRemaining: uploadRemaining,
          uploadBytesOriginal: BigInt(50 * 1024 ** 3),
          downloadBytesRemaining: downloadRemaining,
          nextExpiryDate: FUTURE_EXPIRY,
          activeRowCount: 3,
        })

      const summary = await CreditsUseCases.getSummary(baseUser)

      // Cap is upload-only — download bytes are not allocated on purchase
      // and do not factor into maxPurchasableBytes.
      expect(summary.maxPurchasableBytes).toBe(cap - uploadRemaining)
      expect(summary.canPurchase).toBe(true)
    })

    it('populates batchCount and nextExpiryDate from repository', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({
          uploadBytesRemaining: BigInt(1024),
          uploadBytesOriginal: BigInt(2048),
          downloadBytesRemaining: BigInt(1024),
          nextExpiryDate: SOON_EXPIRY,
          activeRowCount: 5,
        })

      const summary = await CreditsUseCases.getSummary(baseUser)

      expect(summary.batchCount).toBe(5)
      expect(summary.nextExpiryDate).toEqual(SOON_EXPIRY)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // getBatches
  // ──────────────────────────────────────────────────────────────────────────

  describe('getBatches', () => {
    it('returns the full purchase history from repository', async () => {
      const credits = [makeCreditRow(), makeCreditRow({ id: 'credit-2' })]
      jest
        .spyOn(purchasedCreditsRepository, 'getByAccountId')
        .mockResolvedValue(credits)

      const result = await CreditsUseCases.getBatches(baseUser)

      expect(result).toEqual(credits)
      expect(
        purchasedCreditsRepository.getByAccountId,
      ).toHaveBeenCalledWith(mockAccount.id)
    })

    it('returns an empty array when no purchases exist', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'getByAccountId')
        .mockResolvedValue([])

      const result = await CreditsUseCases.getBatches(baseUser)
      expect(result).toEqual([])
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // getExpiringBatches
  // ──────────────────────────────────────────────────────────────────────────

  describe('getExpiringBatches', () => {
    it('returns rows expiring soon via per-account repository method', async () => {
      const expiring = [makeCreditRow({ expiresAt: SOON_EXPIRY })]
      jest
        .spyOn(purchasedCreditsRepository, 'getExpiringCreditsByAccountId')
        .mockResolvedValue(expiring)

      const result = await CreditsUseCases.getExpiringBatches(baseUser)

      expect(result).toEqual(expiring)
      expect(
        purchasedCreditsRepository.getExpiringCreditsByAccountId,
      ).toHaveBeenCalledWith(mockAccount.id, 30)
    })

    it('returns empty array when nothing is expiring', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'getExpiringCreditsByAccountId')
        .mockResolvedValue([])

      const result = await CreditsUseCases.getExpiringBatches(baseUser)
      expect(result).toEqual([])
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // getEconomics
  // ──────────────────────────────────────────────────────────────────────────

  describe('getEconomics', () => {
    it('returns 403 ForbiddenError for non-admin user', async () => {
      const getAggregateSpy = jest
        .spyOn(purchasedCreditsRepository, 'getExpiringCreditsAggregate')
        .mockResolvedValue({
          count: 0,
          totalUploadBytesRemaining: 0n,
          totalDownloadBytesRemaining: 0n,
        })

      const result = await CreditsUseCases.getEconomics(nonAdminUser)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
      expect(getAggregateSpy).not.toHaveBeenCalled()
    })

    it('returns aggregated economics for admin user', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'getExpiringCreditsAggregate')
        .mockResolvedValue({
          count: 2,
          totalUploadBytesRemaining:
            BigInt(2 * 1024 ** 3) + BigInt(1024 ** 3),
          totalDownloadBytesRemaining:
            BigInt(3 * 1024 ** 3) + BigInt(2 * 1024 ** 3),
        })

      const result = await CreditsUseCases.getEconomics(adminUser)

      expect(result.isOk()).toBe(true)
      const economics = result._unsafeUnwrap()
      expect(economics.totalExpiringWithin30Days).toBe(2)
      expect(economics.totalExpiringUploadBytes).toBe(
        BigInt(2 * 1024 ** 3) + BigInt(1024 ** 3),
      )
      expect(economics.totalExpiringDownloadBytes).toBe(
        BigInt(3 * 1024 ** 3) + BigInt(2 * 1024 ** 3),
      )
    })

    it('returns zeros when no credits are expiring soon', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'getExpiringCreditsAggregate')
        .mockResolvedValue({
          count: 0,
          totalUploadBytesRemaining: 0n,
          totalDownloadBytesRemaining: 0n,
        })

      const result = await CreditsUseCases.getEconomics(adminUser)

      expect(result.isOk()).toBe(true)
      const economics = result._unsafeUnwrap()
      expect(economics.totalExpiringWithin30Days).toBe(0)
      expect(economics.totalExpiringUploadBytes).toBe(0n)
      expect(economics.totalExpiringDownloadBytes).toBe(0n)
    })

    it('queries within 30 days window', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'getExpiringCreditsAggregate')
        .mockResolvedValue({
          count: 0,
          totalUploadBytesRemaining: 0n,
          totalDownloadBytesRemaining: 0n,
        })

      await CreditsUseCases.getEconomics(adminUser)

      expect(
        purchasedCreditsRepository.getExpiringCreditsAggregate,
      ).toHaveBeenCalledWith(30)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // refundBatch
  // ──────────────────────────────────────────────────────────────────────────

  const VALID_TX_HASH = `0x${'a'.repeat(64)}`

  // purchased_credits ids are UUIDs; the use cases reject anything else
  // with 400 before reaching the repository.
  const BATCH_1 = '11111111-1111-4111-8111-111111111111'
  const BATCH_2 = '22222222-2222-4222-8222-222222222222'
  const BATCH_3 = '33333333-3333-4333-8333-333333333333'
  const MISSING_ID = '99999999-9999-4999-8999-999999999999'

  describe('refundBatch', () => {
    it('returns 403 ForbiddenError for non-admin user', async () => {
      const markSpy = jest
        .spyOn(purchasedCreditsRepository, 'markAsRefunded')
        .mockResolvedValue({ found: true, row: makeCreditRow() })

      const result = await CreditsUseCases.refundBatch(
        nonAdminUser,
        BATCH_1,
        VALID_TX_HASH,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('returns 400 BadRequestError when no tx hash is provided', async () => {
      const markSpy = jest
        .spyOn(purchasedCreditsRepository, 'markAsRefunded')
        .mockResolvedValue({ found: true, row: makeCreditRow() })

      for (const missing of [undefined, null, '', '   ']) {
        const result = await CreditsUseCases.refundBatch(
          adminUser,
          BATCH_1,
          missing,
        )

        expect(result.isErr()).toBe(true)
        expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      }

      // The batch must never be marked as refunded without a tx hash.
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('returns 400 BadRequestError for malformed tx hashes', async () => {
      const markSpy = jest
        .spyOn(purchasedCreditsRepository, 'markAsRefunded')
        .mockResolvedValue({ found: true, row: makeCreditRow() })

      const malformed = [
        'not-a-hash',
        '0x1234', // too short
        `0x${'a'.repeat(63)}`, // 63 hex chars
        `0x${'a'.repeat(65)}`, // 65 hex chars
        `0x${'g'.repeat(64)}`, // non-hex characters
        `${'a'.repeat(64)}`, // missing 0x prefix
        12345, // not a string
      ]

      for (const hash of malformed) {
        const result = await CreditsUseCases.refundBatch(
          adminUser,
          BATCH_1,
          hash,
        )

        expect(result.isErr()).toBe(true)
        expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      }

      expect(markSpy).not.toHaveBeenCalled()
    })

    it('returns 400 BadRequestError for a non-UUID batch id', async () => {
      const markSpy = jest
        .spyOn(purchasedCreditsRepository, 'markAsRefunded')
        .mockResolvedValue({ found: true, row: makeCreditRow() })

      for (const invalid of ['credit-1', 'not-a-uuid', '11111111', '']) {
        const result = await CreditsUseCases.refundBatch(
          adminUser,
          invalid,
          VALID_TX_HASH,
        )

        expect(result.isErr()).toBe(true)
        expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      }

      // Must never reach the repository, where a non-UUID id would fail the
      // Postgres uuid cast and surface as a 500.
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('marks the batch as refunded with the trimmed tx hash', async () => {
      const markSpy = jest
        .spyOn(purchasedCreditsRepository, 'markAsRefunded')
        .mockResolvedValue({
          found: true,
          row: makeCreditRow({
            refundedAt: now,
            refundTxHash: VALID_TX_HASH,
          }),
        })

      const result = await CreditsUseCases.refundBatch(
        adminUser,
        BATCH_1,
        `  ${VALID_TX_HASH}  `,
      )

      expect(result.isOk()).toBe(true)
      expect(markSpy).toHaveBeenCalledWith(BATCH_1, VALID_TX_HASH)
    })

    it('returns 404 NotFoundError when the batch does not exist', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'markAsRefunded')
        .mockResolvedValue({ found: false, row: null })

      const result = await CreditsUseCases.refundBatch(
        adminUser,
        MISSING_ID,
        VALID_TX_HASH,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    })

    it('is a no-op returning ok() when the batch is already refunded', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'markAsRefunded')
        .mockResolvedValue({ found: true, row: null })

      const result = await CreditsUseCases.refundBatch(
        adminUser,
        BATCH_1,
        VALID_TX_HASH,
      )

      expect(result.isOk()).toBe(true)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // refundBatches
  // ──────────────────────────────────────────────────────────────────────────

  describe('refundBatches', () => {
    it('returns 403 ForbiddenError for non-admin user', async () => {
      const markSpy = jest
        .spyOn(purchasedCreditsRepository, 'markManyAsRefunded')
        .mockResolvedValue({
          missingIds: [],
          accountIds: ['account-id'],
          walletAddresses: ['0xwallet-1'],
          refundedRows: [makeCreditRow()],
          alreadyRefundedIds: [],
        })

      const result = await CreditsUseCases.refundBatches(
        nonAdminUser,
        [BATCH_1],
        VALID_TX_HASH,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('returns 400 BadRequestError for an empty or invalid batchIds payload', async () => {
      const markSpy = jest
        .spyOn(purchasedCreditsRepository, 'markManyAsRefunded')
        .mockResolvedValue({
          missingIds: [],
          accountIds: ['account-id'],
          walletAddresses: ['0xwallet-1'],
          refundedRows: [],
          alreadyRefundedIds: [],
        })

      for (const invalid of [undefined, null, [], [BATCH_1, ''], BATCH_1, [42]]) {
        const result = await CreditsUseCases.refundBatches(
          adminUser,
          invalid,
          VALID_TX_HASH,
        )

        expect(result.isErr()).toBe(true)
        expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      }

      expect(markSpy).not.toHaveBeenCalled()
    })

    it('returns 400 BadRequestError listing non-UUID batch ids', async () => {
      const markSpy = jest
        .spyOn(purchasedCreditsRepository, 'markManyAsRefunded')
        .mockResolvedValue({
          missingIds: [],
          accountIds: ['account-id'],
          walletAddresses: ['0xwallet-1'],
          refundedRows: [],
          alreadyRefundedIds: [],
        })

      const result = await CreditsUseCases.refundBatches(
        adminUser,
        [BATCH_1, 'not-a-uuid'],
        VALID_TX_HASH,
      )

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(BadRequestError)
      expect(error.message).toContain('not-a-uuid')
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('returns 400 BadRequestError when no tx hash is provided and updates nothing', async () => {
      const markSpy = jest
        .spyOn(purchasedCreditsRepository, 'markManyAsRefunded')
        .mockResolvedValue({
          missingIds: [],
          accountIds: ['account-id'],
          walletAddresses: ['0xwallet-1'],
          refundedRows: [],
          alreadyRefundedIds: [],
        })

      const result = await CreditsUseCases.refundBatches(
        adminUser,
        [BATCH_1, BATCH_2],
        undefined,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('returns 400 BadRequestError when batches span multiple accounts', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'markManyAsRefunded')
        .mockResolvedValue({
          missingIds: [],
          accountIds: ['account-a', 'account-b'],
          walletAddresses: ['0xwallet-1'],
          refundedRows: [],
          alreadyRefundedIds: [],
        })

      const result = await CreditsUseCases.refundBatches(
        adminUser,
        [BATCH_1, BATCH_2],
        VALID_TX_HASH,
      )

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(BadRequestError)
      expect(error.message).toContain('same account')
    })

    it('returns 400 BadRequestError when batches were paid from different wallets', async () => {
      // Same account, but the batches were purchased from two different EVM
      // wallets — one refund transfer can only go back to one wallet.
      jest
        .spyOn(purchasedCreditsRepository, 'markManyAsRefunded')
        .mockResolvedValue({
          missingIds: [],
          accountIds: ['account-id'],
          walletAddresses: ['0xwallet-1', '0xwallet-2'],
          refundedRows: [],
          alreadyRefundedIds: [],
        })

      const result = await CreditsUseCases.refundBatches(
        adminUser,
        [BATCH_1, BATCH_2],
        VALID_TX_HASH,
      )

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(BadRequestError)
      expect(error.message).toContain('same purchasing wallet')
    })

    it('returns 400 BadRequestError when wallets differ by known vs unknown', async () => {
      // A batch with no recorded from_address (legacy intent) cannot be
      // combined with a batch paid from a known wallet.
      jest
        .spyOn(purchasedCreditsRepository, 'markManyAsRefunded')
        .mockResolvedValue({
          missingIds: [],
          accountIds: ['account-id'],
          walletAddresses: ['0xwallet-1', null],
          refundedRows: [],
          alreadyRefundedIds: [],
        })

      const result = await CreditsUseCases.refundBatches(
        adminUser,
        [BATCH_1, BATCH_2],
        VALID_TX_HASH,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    })

    it('succeeds idempotently when every batch is already refunded', async () => {
      // Already-refunded rows are excluded from the single-account check
      // (they keep their original tx hash), so a retry where everything is
      // already refunded returns ok — even across accounts (accountIds only
      // reflects rows still pending refund, here none).
      jest
        .spyOn(purchasedCreditsRepository, 'markManyAsRefunded')
        .mockResolvedValue({
          missingIds: [],
          accountIds: [],
          walletAddresses: [],
          refundedRows: [],
          alreadyRefundedIds: [BATCH_1, BATCH_2],
        })

      const result = await CreditsUseCases.refundBatches(
        adminUser,
        [BATCH_1, BATCH_2],
        VALID_TX_HASH,
      )

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        refundedCount: 0,
        alreadyRefundedCount: 2,
      })
    })

    it('returns 404 NotFoundError listing missing ids', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'markManyAsRefunded')
        .mockResolvedValue({
          missingIds: [MISSING_ID],
          accountIds: ['account-id'],
          walletAddresses: ['0xwallet-1'],
          refundedRows: [],
          alreadyRefundedIds: [],
        })

      const result = await CreditsUseCases.refundBatches(
        adminUser,
        [BATCH_1, MISSING_ID],
        VALID_TX_HASH,
      )

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(NotFoundError)
      expect(error.message).toContain(MISSING_ID)
    })

    it('refunds several batches with one tx hash and de-duplicates ids', async () => {
      const markSpy = jest
        .spyOn(purchasedCreditsRepository, 'markManyAsRefunded')
        .mockResolvedValue({
          missingIds: [],
          accountIds: ['account-id'],
          walletAddresses: ['0xwallet-1'],
          refundedRows: [
            makeCreditRow({ id: BATCH_1, refundedAt: now }),
            makeCreditRow({ id: BATCH_2, refundedAt: now }),
          ],
          alreadyRefundedIds: [BATCH_3],
        })

      const result = await CreditsUseCases.refundBatches(
        adminUser,
        [BATCH_1, BATCH_2, BATCH_2, BATCH_3],
        VALID_TX_HASH,
      )

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        refundedCount: 2,
        alreadyRefundedCount: 1,
      })
      expect(markSpy).toHaveBeenCalledWith(
        [BATCH_1, BATCH_2, BATCH_3],
        VALID_TX_HASH,
      )
    })
  })
})
