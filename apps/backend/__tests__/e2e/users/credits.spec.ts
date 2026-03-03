import {
  InteractionType,
  AccountModel,
  UserWithOrganization,
} from '@auto-drive/models'
import { PreconditionError } from '../../utils/error.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/index.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { jest } from '@jest/globals'

describe('CreditsUseCases', () => {
  let mockUser: UserWithOrganization

  beforeEach(async () => {
    mockRabbitPublish()
    await getDatabase()
    await dbMigration.up()
    mockUser = createMockUser()
    const result = await AccountsUseCases.getOrCreateAccount(mockUser)
    if (!result) throw new PreconditionError('Failed to setup test user')
  })

  afterEach(async () => {
    unmockMethods()
    await dbMigration.down()
  })

  it('should consume free-tier credits on upload interaction', async () => {
    const interactionType = InteractionType.Upload
    const size = BigInt(1024)

    const initialCredits =
      await AccountsUseCases.getPendingCreditsByUserAndType(
        mockUser,
        interactionType,
      )

    await AccountsUseCases.registerInteraction(mockUser, interactionType, size)

    const pendingCredits =
      await AccountsUseCases.getPendingCreditsByUserAndType(
        mockUser,
        interactionType,
      )

    expect(initialCredits - pendingCredits).toEqual(Number(size))
  })

  it('should consume free-tier credits on download interaction', async () => {
    const interactionType = InteractionType.Download
    const size = BigInt(2048)

    const initialCredits =
      await AccountsUseCases.getPendingCreditsByUserAndType(
        mockUser,
        interactionType,
      )

    await AccountsUseCases.registerInteraction(mockUser, interactionType, size)

    const pendingCredits =
      await AccountsUseCases.getPendingCreditsByUserAndType(
        mockUser,
        interactionType,
      )

    expect(initialCredits - pendingCredits).toBe(Number(size).valueOf())
  })

  it('should create a purchased_credits row when credits are added', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(mockUser)
    const account = await AccountsUseCases.getOrCreateAccount(mockUser)

    const creditsToAdd = BigInt(123)
    const intentId = 'mock-intent-id-001'

    const result = await AccountsUseCases.addCreditsToAccount(
      mockUser.publicId,
      creditsToAdd,
      intentId,
    )

    expect(result.isOk()).toBe(true)

    // A purchased_credits row should now exist for this account.
    const rows = await purchasedCreditsRepository.getByAccountId(account.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].uploadBytesOriginal).toBe(creditsToAdd)
    expect(rows[0].uploadBytesRemaining).toBe(creditsToAdd)
    expect(rows[0].intentId).toBe(intentId)

    // The free/one-off account limits must remain untouched.
    const after = await AccountsUseCases.getAccountById(account.id)
    if (!after) throw new Error('Account not found')
    expect(after.uploadLimit).toBe(account.uploadLimit)
    expect(after.downloadLimit).toBe(account.downloadLimit)
  })

  it('purchased credits should count toward the total available credits', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(mockUser)
    const account = await AccountsUseCases.getOrCreateAccount(mockUser)

    const creditsToAdd = BigInt(100 * 1024)
    const intentId = 'mock-intent-id-002'

    const before = await AccountsUseCases.getPendingCreditsByUserAndType(
      mockUser,
      InteractionType.Upload,
    )

    await AccountsUseCases.addCreditsToAccount(
      mockUser.publicId,
      creditsToAdd,
      intentId,
    )

    const after = await AccountsUseCases.getPendingCreditsByUserAndType(
      mockUser,
      InteractionType.Upload,
    )

    // The total pending credits must have grown by exactly the purchased amount.
    expect(after - before).toBe(Number(creditsToAdd))

    // And the free-tier account limits remain unchanged.
    const acct = await AccountsUseCases.getAccountById(account.id)
    if (!acct) throw new Error('Account not found')
    expect(acct.uploadLimit).toBe(account.uploadLimit)
  })

  it('should add credits to accounts of any model (not restricted to OneOff)', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(mockUser)
    const account = await AccountsUseCases.getOrCreateAccount(mockUser)

    // Switch to Monthly model — purchased credits should still work.
    await accountsRepository.updateAccount(
      account.id,
      AccountModel.Monthly,
      account.uploadLimit,
      account.downloadLimit,
    )

    const result = await AccountsUseCases.addCreditsToAccount(
      mockUser.publicId,
      BigInt(50),
      'mock-intent-id-003',
    )

    expect(result.isOk()).toBe(true)

    const rows = await purchasedCreditsRepository.getByAccountId(account.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].uploadBytesOriginal).toBe(BigInt(50))
  })

  it('should reject a purchase that would exceed the per-user cap', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(mockUser)

    // Manually insert a row that consumes most of the cap (100 GiB).
    // We mock getRemainingCredits to simulate a near-full account rather than
    // inserting 100 GiB worth of real rows.
    const account = await AccountsUseCases.getOrCreateAccount(mockUser)

    // Insert a large existing credit row directly so the cap check fires.
    const largeBytes = BigInt(100 * 1024 * 1024 * 1024) // 100 GiB
    await purchasedCreditsRepository.createPurchasedCredit({
      accountId: account.id,
      intentId: 'existing-intent',
      uploadBytesOriginal: largeBytes,
      downloadBytesOriginal: largeBytes,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    })

    // Trying to add even 1 more byte should be rejected.
    const result = await AccountsUseCases.addCreditsToAccount(
      mockUser.publicId,
      BigInt(1),
      'over-cap-intent',
    )

    expect(result.isErr()).toBe(true)
  })
})
