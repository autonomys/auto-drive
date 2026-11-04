import {
  DeletionRequest,
  DeletionRequestStatus,
  IntentStatus,
  UserWithOrganization,
} from '@auto-drive/models'
import { jest } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { DeletionUseCases } from '../../../src/core/users/deletion.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { deletionAuditRepository } from '../../../src/infrastructure/repositories/deletionAudit.js'

const insertIntent = async (
  userPublicId: string,
  status: IntentStatus,
  accountId: string | null = null,
): Promise<string> => {
  const db = await getDatabase()
  const id = `test-intent-${uuidv4()}`
  await db.query(
    `INSERT INTO intents
       (id, user_public_id, status, shannons_per_byte, expires_at, account_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userPublicId, status, '1', new Date(Date.now() + 60_000), accountId],
  )
  return id
}

const getIntentStatus = async (id: string): Promise<string> => {
  const db = await getDatabase()
  const result = await db.query<{ status: string }>(
    'SELECT status FROM intents WHERE id = $1',
    [id],
  )
  return result.rows[0].status
}

const deletionRequestFor = (user: UserWithOrganization): DeletionRequest => ({
  id: uuidv4(),
  userPublicId: user.publicId,
  oauthProvider: user.oauthProvider,
  oauthUserId: user.oauthUserId,
  status: DeletionRequestStatus.Processing,
  requestedAt: new Date(),
  scheduledAnonymisationAt: new Date(),
  completedAt: null,
  cancelledAt: null,
  reason: null,
  adminNotes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
})

describe('Deletion in personal and partner organizations', () => {
  let user: UserWithOrganization
  let accountId: string
  let pendingIntentId: string
  let confirmedIntentId: string

  beforeEach(async () => {
    mockRabbitPublish()
    await getDatabase()
    await dbMigration.up()

    user = createMockUser()
    accountId = (await AccountsUseCases.getOrCreateAccount(user)).id
    const purchaseIntentId = await insertIntent(
      user.publicId,
      IntentStatus.CONFIRMED,
    )
    await AccountsUseCases.addCreditsToAccount(
      { id: purchaseIntentId, userPublicId: user.publicId, accountId },
      BigInt(1000),
    )
    pendingIntentId = await insertIntent(user.publicId, IntentStatus.PENDING)
    confirmedIntentId = await insertIntent(
      user.publicId,
      IntentStatus.CONFIRMED,
      accountId,
    )

    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(user)
    jest
      .spyOn(AuthManager, 'markDeletionAsProcessing')
      .mockImplementation(async (id) => ({
        ...deletionRequestFor(user),
        id,
      }))
    jest
      .spyOn(AuthManager, 'executeAuthAnonymisation')
      .mockResolvedValue(undefined)
    jest
      .spyOn(AuthManager, 'markDeletionAsCompleted')
      .mockResolvedValue(deletionRequestFor(user))
  })

  afterEach(async () => {
    unmockMethods()
    jest.restoreAllMocks()
    await dbMigration.down()
  })

  const lastCompletion = async () => {
    const entries = await deletionAuditRepository.getByUser(user.publicId)
    return entries.find((e) => e.action === 'anonymisation_completed')
  }

  it('expires the credits of a personal account', async () => {
    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))

    const { uploadBytesRemaining } =
      await purchasedCreditsRepository.getRemainingCredits(accountId)
    expect(uploadBytesRemaining).toBe(0n)
    expect(await getIntentStatus(pendingIntentId)).toBe(IntentStatus.EXPIRED)
    // Not yet credited, so it would otherwise reach the account afterwards.
    expect(await getIntentStatus(confirmedIntentId)).toBe(IntentStatus.EXPIRED)
    expect((await lastCompletion())?.details).toMatchObject({
      organizationCase: 'personal_organization',
      creditsExpired: 1,
    })
  })

  it('leaves purchases the user made for other accounts alone', async () => {
    const otherAccountId = (
      await AccountsUseCases.getOrCreateAccount(createMockUser())
    ).id
    const otherAccountIntentId = await insertIntent(
      user.publicId,
      IntentStatus.CONFIRMED,
      otherAccountId,
    )
    // From before intents recorded an account: credited to the buyer's
    // current account, which is the forfeited one.
    const legacyIntentId = await insertIntent(
      user.publicId,
      IntentStatus.CONFIRMED,
    )
    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))

    expect(await getIntentStatus(otherAccountIntentId)).toBe(
      IntentStatus.CONFIRMED,
    )
    expect(await getIntentStatus(legacyIntentId)).toBe(IntentStatus.EXPIRED)
  })

  it('credits nothing when the confirmation lands after the deletion', async () => {
    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))
    // The poller read the intent while it was still confirmed.
    const credited = await AccountsUseCases.addCreditsToAccount(
      { id: confirmedIntentId, userPublicId: user.publicId, accountId },
      BigInt(500),
    )

    expect(credited.isErr()).toBe(true)
    const { uploadBytesRemaining } =
      await purchasedCreditsRepository.getRemainingCredits(accountId)
    expect(uploadBytesRemaining).toBe(0n)
    expect(await getIntentStatus(confirmedIntentId)).toBe(IntentStatus.EXPIRED)
  })

  // Auth marks a failed request Failed and never picks it up again, so this
  // is the run after someone reset it to pending by hand. The mocked
  // markDeletionAsProcessing stands in for that reset.
  it('keeps the membership when the cleanup fails, so a request reset by hand still forfeits', async () => {
    let member = true
    jest
      .spyOn(AuthManager, 'getUserFromPublicId')
      .mockImplementation(async () => ({
        ...user,
        organizationId: member ? user.organizationId : null,
      }))
    jest
      .spyOn(AuthManager, 'markDeletionAsFailed')
      .mockResolvedValue(deletionRequestFor(user))
    jest
      .spyOn(AuthManager, 'executeAuthAnonymisation')
      .mockRejectedValueOnce(new Error('auth unavailable'))
      .mockImplementation(async () => {
        member = false
      })

    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))
    expect(member).toBe(true)

    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))

    // The rerun still finds the account and forfeits it again.
    const entries = await deletionAuditRepository.getByUser(user.publicId)
    expect(entries.filter((e) => e.action === 'credits_expired')).toHaveLength(
      2,
    )
    expect(await getIntentStatus(confirmedIntentId)).toBe(IntentStatus.EXPIRED)
  })

  // A member added or removed during the deletion doesn't change this.
  it('keeps the credits of a partner account, even when the user is its last member', async () => {
    const db = await getDatabase()
    await db.query('UPDATE accounts SET is_partner = TRUE WHERE id = $1', [
      accountId,
    ])
    const otherPendingIntentId = await insertIntent(
      createMockUser().publicId,
      IntentStatus.PENDING,
    )

    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))

    const { uploadBytesRemaining } =
      await purchasedCreditsRepository.getRemainingCredits(accountId)
    expect(uploadBytesRemaining).toBe(1000n)
    // Only the deleted user's own pending intents are expired. Confirmed ones
    // are still credited to the partner account.
    expect(await getIntentStatus(pendingIntentId)).toBe(IntentStatus.EXPIRED)
    expect(await getIntentStatus(confirmedIntentId)).toBe(
      IntentStatus.CONFIRMED,
    )
    expect(await getIntentStatus(otherPendingIntentId)).toBe(
      IntentStatus.PENDING,
    )
    expect((await lastCompletion())?.details).toMatchObject({
      organizationCase: 'partner_organization',
      creditsExpired: 0,
    })
  })
})
