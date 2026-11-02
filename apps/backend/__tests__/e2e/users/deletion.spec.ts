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

describe('Deletion in shared organizations', () => {
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
      IntentStatus.COMPLETED,
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

  it('expires the account credits when the user is its only member', async () => {
    jest
      .spyOn(AuthManager, 'getOrganizationMembers')
      .mockResolvedValue([user.publicId])

    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))

    const { uploadBytesRemaining } =
      await purchasedCreditsRepository.getRemainingCredits(accountId)
    expect(uploadBytesRemaining).toBe(0n)
    expect(await getIntentStatus(pendingIntentId)).toBe(IntentStatus.EXPIRED)
    // Not yet credited, so it would otherwise reach the account afterwards.
    expect(await getIntentStatus(confirmedIntentId)).toBe(IntentStatus.EXPIRED)
    expect((await lastCompletion())?.details).toMatchObject({
      organizationCase: 'sole_member',
      creditsExpired: 1,
    })
  })

  it('forfeits the credits when two members are deleted at once', async () => {
    const otherMember = {
      ...createMockUser(),
      organizationId: user.organizationId,
    }
    const members = new Set([user.publicId, otherMember.publicId])
    const owners = new Map<string, string>()
    const requests = [user, otherMember].map((member) => {
      const request = deletionRequestFor(member)
      owners.set(request.id, member.publicId)
      return request
    })
    jest
      .spyOn(AuthManager, 'getUserFromPublicId')
      .mockImplementation(async (publicId) =>
        publicId === user.publicId ? user : otherMember,
      )
    jest
      .spyOn(AuthManager, 'markDeletionAsProcessing')
      .mockImplementation(
        async (id) => requests.find((r) => r.id === id) ?? null,
      )
    // Each deletion reads the members once both have got this far. Unless the
    // deletions take turns, neither has removed itself by then.
    const arrived: Array<() => void> = []
    jest
      .spyOn(AuthManager, 'getOrganizationMembers')
      .mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          arrived.push(resolve)
          if (arrived.length === 2) arrived.forEach((release) => release())
          else setTimeout(resolve, 300)
        })
        return [...members]
      })
    jest
      .spyOn(AuthManager, 'executeAuthAnonymisation')
      .mockImplementation(async (id) => {
        members.delete(owners.get(id)!)
      })

    await Promise.all(
      requests.map((request) => DeletionUseCases.processAnonymisation(request)),
    )

    const { uploadBytesRemaining } =
      await purchasedCreditsRepository.getRemainingCredits(accountId)
    expect(uploadBytesRemaining).toBe(0n)
  })

  it('keeps the membership when the cleanup fails, so a retry still forfeits', async () => {
    const members = new Set([user.publicId])
    jest
      .spyOn(AuthManager, 'getOrganizationMembers')
      .mockImplementation(async () => [...members])
    jest
      .spyOn(AuthManager, 'markDeletionAsFailed')
      .mockResolvedValue(deletionRequestFor(user))
    jest
      .spyOn(AuthManager, 'executeAuthAnonymisation')
      .mockRejectedValueOnce(new Error('auth unavailable'))
      .mockImplementation(async () => {
        members.delete(user.publicId)
      })

    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))
    expect(members.has(user.publicId)).toBe(true)

    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))

    expect((await lastCompletion())?.details).toMatchObject({
      organizationCase: 'sole_member',
    })
    expect(await getIntentStatus(confirmedIntentId)).toBe(IntentStatus.EXPIRED)
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
      .spyOn(AuthManager, 'getOrganizationMembers')
      .mockResolvedValue([user.publicId, otherMember.publicId])

    await DeletionUseCases.processAnonymisation(deletionRequestFor(user))

    const { uploadBytesRemaining } =
      await purchasedCreditsRepository.getRemainingCredits(accountId)
    expect(uploadBytesRemaining).toBe(1000n)
    // Only the deleted user's own pending intents are expired. Confirmed ones
    // are still credited to the shared account.
    expect(await getIntentStatus(pendingIntentId)).toBe(IntentStatus.EXPIRED)
    expect(await getIntentStatus(confirmedIntentId)).toBe(
      IntentStatus.CONFIRMED,
    )
    expect(await getIntentStatus(otherPendingIntentId)).toBe(
      IntentStatus.PENDING,
    )
    expect((await lastCompletion())?.details).toMatchObject({
      organizationCase: 'shared_organization',
      creditsExpired: 0,
    })
  })
})
