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
): Promise<string> => {
  const db = await getDatabase()
  const id = `test-intent-${uuidv4()}`
  await db.query(
    `INSERT INTO intents (id, user_public_id, status, shannons_per_byte, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userPublicId, status, '1', new Date(Date.now() + 60_000)],
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

describe('Deletion in shared organizations', () => {
  let user: UserWithOrganization
  let accountId: string
  let pendingIntentId: string

  beforeEach(async () => {
    mockRabbitPublish()
    await getDatabase()
    await dbMigration.up()

    user = createMockUser()
    accountId = (await AccountsUseCases.getOrCreateAccount(user)).id
    const purchaseIntentId = await insertIntent(
      user.publicId,
      IntentStatus.COMPLETED,
    )
    await AccountsUseCases.addCreditsToAccount(
      { id: purchaseIntentId, userPublicId: user.publicId, accountId },
      BigInt(1000),
    )
    pendingIntentId = await insertIntent(user.publicId, IntentStatus.PENDING)

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
    const entries = await deletionAuditRepository.getByUser(
      user.publicId,
    )
    return entries.find((e) => e.action === 'anonymisation_completed')
  }

  it('expires the account credits when the user is its only member', async () => {
    jest.spyOn(AuthManager, 'adminSearchUsers').mockResolvedValue([user])

    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))

    const { uploadBytesRemaining } =
      await purchasedCreditsRepository.getRemainingCredits(accountId)
    expect(uploadBytesRemaining).toBe(0n)
    expect(await getIntentStatus(pendingIntentId)).toBe(IntentStatus.EXPIRED)
    expect((await lastCompletion())?.details).toMatchObject({
      organizationCase: 'sole_member',
      creditsExpired: 1,
    })
  })

  it('keeps the account credits when other members remain', async () => {
    const otherMember = {
      ...createMockUser(),
      organizationId: user.organizationId,
    }
    const otherPendingIntentId = await insertIntent(
      otherMember.publicId,
      IntentStatus.PENDING,
    )
    jest
      .spyOn(AuthManager, 'adminSearchUsers')
      .mockResolvedValue([user, otherMember])

    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))

    const { uploadBytesRemaining } =
      await purchasedCreditsRepository.getRemainingCredits(accountId)
    expect(uploadBytesRemaining).toBe(1000n)
    // Only the deleted user's own pending intents are expired.
    expect(await getIntentStatus(pendingIntentId)).toBe(IntentStatus.EXPIRED)
    expect(await getIntentStatus(otherPendingIntentId)).toBe(
      IntentStatus.PENDING,
    )
    expect((await lastCompletion())?.details).toMatchObject({
      organizationCase: 'shared_organization',
      creditsExpired: 0,
    })
  })
})
