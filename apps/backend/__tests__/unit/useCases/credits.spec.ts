import { jest } from '@jest/globals'
import { CreditsUseCases } from '../../../src/core/users/credits.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { ForbiddenError } from '../../../src/errors/index.js'
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
          downloadBytesRemaining: 0n,
          nextExpiryDate: null,
          activeRowCount: 0,
        })

      const summary = await CreditsUseCases.getSummary(baseUser)

      expect(summary.uploadBytesRemaining).toBe(0n)
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
          downloadBytesRemaining: cap,
          nextExpiryDate: FUTURE_EXPIRY,
          activeRowCount: 1,
        })

      const summary = await CreditsUseCases.getSummary(baseUser)

      expect(summary.canPurchase).toBe(false)
      expect(summary.maxPurchasableBytes).toBe(0n)
    })

    it('handles asymmetric remaining bytes (download higher than upload)', async () => {
      const uploadRemaining = BigInt(30 * 1024 ** 3)
      const downloadRemaining = BigInt(70 * 1024 ** 3) // download is binding
      const cap = config.credits.maxBytesPerUser

      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({
          uploadBytesRemaining: uploadRemaining,
          downloadBytesRemaining: downloadRemaining,
          nextExpiryDate: FUTURE_EXPIRY,
          activeRowCount: 3,
        })

      const summary = await CreditsUseCases.getSummary(baseUser)

      // Download (70 GiB) is the binding constraint
      expect(summary.maxPurchasableBytes).toBe(cap - downloadRemaining)
      expect(summary.canPurchase).toBe(true)
    })

    it('populates batchCount and nextExpiryDate from repository', async () => {
      jest
        .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
        .mockResolvedValue({
          uploadBytesRemaining: BigInt(1024),
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
})
