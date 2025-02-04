import { InteractionType } from '../../../src/models/objects/interactions'
import { PreconditionError } from '../../utils/error'
import { closeDatabase, getDatabase } from '../../../src/drivers/pg'
import { UserWithOrganization } from '../../../src/models/users'
import { createMockUser } from '../../utils/mocks'
import { dbMigration } from '../../utils/dbMigrate'
import { SubscriptionsUseCases } from '../../../src/useCases'

describe('CreditsUseCases', () => {
  let mockUser: UserWithOrganization

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
    mockUser = createMockUser()
    const result = await SubscriptionsUseCases.getOrCreateSubscription(mockUser)
    if (!result) throw new PreconditionError('Failed to setup test user')
  })

  afterAll(async () => {
    await closeDatabase()
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

    expect(initialCredits - pendingCredits).toEqual(Number(size))
  })
})
