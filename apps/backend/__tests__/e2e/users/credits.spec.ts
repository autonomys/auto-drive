import { InteractionType, UserWithOrganization } from '@auto-drive/models'
import { PreconditionError } from '../../utils/error.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'

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

  it('should create credits for a user', async () => {
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

  it('should create credits for a user on download', async () => {
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
})
