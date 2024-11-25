import { InteractionType } from '../../../src/models/objects/interactions'
import { UsersUseCases } from '../../../src/useCases/users/users'
import { PreconditionError } from '../../utils/error'
import { closeDatabase, getDatabase } from '../../../src/drivers/pg'
import { User } from '../../../src/models/users'
import { MOCK_UNONBOARDED_USER } from '../../utils/mocks'
import { dbMigration } from '../../utils/dbMigrate'

describe('CreditsUseCases', () => {
  let user: User

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
    const result = await UsersUseCases.onboardUser(MOCK_UNONBOARDED_USER)
    if (!result) throw new PreconditionError('Failed to setup test user')
    user = result
  })

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
  })

  it('should create credits for a user', async () => {
    const interactionType = InteractionType.Upload
    const size = BigInt(1024)

    const initialCredits = await UsersUseCases.getPendingCreditsByUserAndType(
      user.publicId,
      interactionType,
    )

    await UsersUseCases.registerInteraction(
      user.publicId,
      interactionType,
      size,
    )

    const pendingCredits = await UsersUseCases.getPendingCreditsByUserAndType(
      user.publicId,
      interactionType,
    )

    expect(initialCredits - pendingCredits).toEqual(Number(size))
  })

  it('should create credits for a user on download', async () => {
    const interactionType = InteractionType.Download
    const size = BigInt(2048)

    const initialCredits = await UsersUseCases.getPendingCreditsByUserAndType(
      user.publicId,
      interactionType,
    )

    await UsersUseCases.registerInteraction(
      user.publicId,
      interactionType,
      size,
    )

    const pendingCredits = await UsersUseCases.getPendingCreditsByUserAndType(
      user.publicId,
      interactionType,
    )

    expect(initialCredits - pendingCredits).toEqual(Number(size))
  })
})
