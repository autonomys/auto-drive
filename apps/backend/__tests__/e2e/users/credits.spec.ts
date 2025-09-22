import {
  InteractionType,
  SubscriptionGranularity,
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
import { SubscriptionsUseCases } from '../../../src/core/users/subscriptions.js'
import { subscriptionsRepository } from '../../../src/infrastructure/repositories/users/subscriptions.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { jest } from '@jest/globals'

describe('CreditsUseCases', () => {
  let mockUser: UserWithOrganization

  beforeEach(async () => {
    mockRabbitPublish()
    await getDatabase()
    await dbMigration.up()
    mockUser = createMockUser()
    const result = await SubscriptionsUseCases.getOrCreateSubscription(mockUser)
    if (!result) throw new PreconditionError('Failed to setup test user')
  })

  afterEach(async () => {
    unmockMethods()
    await dbMigration.down()
  })

  it('should create credits for a user', async () => {
    const interactionType = InteractionType.Upload
    const size = BigInt(1024)

    const initialCredits =
      await SubscriptionsUseCases.getPendingCreditsByUserAndType(
        mockUser,
        interactionType,
      )

    await SubscriptionsUseCases.registerInteraction(
      mockUser,
      interactionType,
      size,
    )

    const pendingCredits =
      await SubscriptionsUseCases.getPendingCreditsByUserAndType(
        mockUser,
        interactionType,
      )

    expect(initialCredits - pendingCredits).toEqual(Number(size))
  })

  it('should create credits for a user on download', async () => {
    const interactionType = InteractionType.Download
    const size = BigInt(2048)

    const initialCredits =
      await SubscriptionsUseCases.getPendingCreditsByUserAndType(
        mockUser,
        interactionType,
      )

    await SubscriptionsUseCases.registerInteraction(
      mockUser,
      interactionType,
      size,
    )

    const pendingCredits =
      await SubscriptionsUseCases.getPendingCreditsByUserAndType(
        mockUser,
        interactionType,
      )

    expect(initialCredits - pendingCredits).toBe(Number(size).valueOf())
  })

  it('should add credits to a OneOff subscription', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(mockUser)
    const subscription =
      await SubscriptionsUseCases.getOrCreateSubscription(mockUser)
    // Ensure subscription is OneOff
    await subscriptionsRepository.updateSubscription(
      subscription.id,
      SubscriptionGranularity.OneOff,
      subscription.uploadLimit,
      subscription.downloadLimit,
    )

    const before = await SubscriptionsUseCases.getSubscriptionById(
      subscription.id,
    )
    if (!before) throw new Error('Subscription not found')

    const creditsToAdd = 123
    const result = await SubscriptionsUseCases.addCreditsToSubscription(
      mockUser.publicId,
      creditsToAdd,
    )

    if (result.isErr()) {
      expect(result._unsafeUnwrapErr()).toBeUndefined()
    }
    expect(result.isOk()).toBe(true)

    const after = await SubscriptionsUseCases.getSubscriptionById(
      subscription.id,
    )
    if (!after) throw new Error('Subscription not found')

    expect(after.uploadLimit - before.uploadLimit).toBe(creditsToAdd)
    expect(after.granularity).toBe(SubscriptionGranularity.OneOff)
  })

  it('should fail to add credits if subscription is not OneOff', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(mockUser)
    const subscription =
      await SubscriptionsUseCases.getOrCreateSubscription(mockUser)
    await subscriptionsRepository.updateSubscription(
      subscription.id,
      SubscriptionGranularity.Monthly,
      subscription.uploadLimit,
      subscription.downloadLimit,
    )

    const result = await SubscriptionsUseCases.addCreditsToSubscription(
      mockUser.publicId,
      10,
    )

    expect(result.isErr()).toBe(true)
  })
})
