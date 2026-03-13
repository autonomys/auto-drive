import {
  InteractionType,
  InteractionSource,
  AccountModel,
  IntentStatus,
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
import { interactionsRepository } from '../../../src/infrastructure/repositories/objects/interactions.js'
import { jest } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'

// Inserts a minimal intent row so the purchased_credits.intent_id FK is satisfied.
const createTestIntent = async (userPublicId: string): Promise<string> => {
  const db = await getDatabase()
  const id = `test-intent-${uuidv4()}`
  await db.query(
    `INSERT INTO intents (id, user_public_id, status, shannons_per_byte, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userPublicId, IntentStatus.COMPLETED, '1', new Date()],
  )
  return id
}

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
    const intentId = await createTestIntent(mockUser.publicId)

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
    const intentId = await createTestIntent(mockUser.publicId)

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

    const intentId = await createTestIntent(mockUser.publicId)
    const result = await AccountsUseCases.addCreditsToAccount(
      mockUser.publicId,
      BigInt(50),
      intentId,
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
    const existingIntentId = await createTestIntent(mockUser.publicId)
    await purchasedCreditsRepository.createPurchasedCredit({
      accountId: account.id,
      intentId: existingIntentId,
      uploadBytesOriginal: largeBytes,
      downloadBytesOriginal: largeBytes,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    })

    // Trying to add even 1 more byte should be rejected.
    const overCapIntentId = await createTestIntent(mockUser.publicId)
    const result = await AccountsUseCases.addCreditsToAccount(
      mockUser.publicId,
      BigInt(1),
      overCapIntentId,
    )

    expect(result.isErr()).toBe(true)
  })

  it('should prevent double-spend when two concurrent 90 MB uploads race against 100 MB of purchased credits', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(mockUser)
    const account = await AccountsUseCases.getOrCreateAccount(mockUser)

    const MB = (n: number) => BigInt(n * 1024 * 1024)

    // Seed exactly 100 MB of purchased credits and zero out the free-tier
    // allocation so the only available budget is the purchased pool.
    const intentId = await createTestIntent(mockUser.publicId)
    await purchasedCreditsRepository.createPurchasedCredit({
      accountId: account.id,
      intentId,
      uploadBytesOriginal: MB(100),
      downloadBytesOriginal: MB(100),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    })
    await accountsRepository.updateAccount(
      account.id,
      AccountModel.OneOff,
      0, // uploadLimit = 0 (no free-tier bytes)
      0, // downloadLimit = 0
    )

    // Fire two concurrent 90 MB upload interactions simultaneously.
    // consumeUpTo serialises access via FOR UPDATE: one caller gets 90 MB,
    // the other only gets 10 MB from purchased credits.  The free-tier guard
    // then detects that the remaining 80 MB cannot be covered by free-tier
    // (uploadLimit = 0), refunds the 10 MB back, and throws.
    const [result1, result2] = await Promise.allSettled([
      AccountsUseCases.registerInteraction(
        mockUser,
        InteractionType.Upload,
        MB(90),
      ),
      AccountsUseCases.registerInteraction(
        mockUser,
        InteractionType.Upload,
        MB(90),
      ),
    ])

    // Exactly one upload succeeds and exactly one is rejected.
    const statuses = [result1.status, result2.status].sort()
    expect(statuses).toEqual(['fulfilled', 'rejected'])

    // The rejected upload must have thrown PaymentRequiredError and refunded
    // the partial purchased-credit deduction.  10 MB (= 100 - 90) must remain.
    const remaining =
      await purchasedCreditsRepository.getRemainingCredits(account.id)
    expect(remaining.uploadBytesRemaining).toBe(MB(10))

    // Only 90 MB should be recorded as consumed from purchased credits —
    // the second caller's partial deduction was rolled back via refundCredits.
    const now = new Date()
    const purchasedInteractions =
      await interactionsRepository.getInteractionsByAccountIdAndTypeInTimeRange(
        account.id,
        InteractionType.Upload,
        new Date(0),
        now,
        InteractionSource.Purchased,
      )
    const totalPurchasedConsumed = purchasedInteractions.reduce(
      (sum, i) => sum + i.size,
      0,
    )
    expect(totalPurchasedConsumed).toBe(Number(MB(90)))

    // After the race, only 10 MB of purchased credits remain and 0 free-tier
    // bytes are available — a new 90 MB upload must be denied at the gate.
    const pendingAfter =
      await AccountsUseCases.getPendingCreditsByUserAndType(
        mockUser,
        InteractionType.Upload,
      )
    expect(pendingAfter).toBe(Number(MB(10)))
  })
})
