import { User, UserRole } from '../../../src/models/users'
import { usersRepository } from '../../../src/repositories'
import { SubscriptionsUseCases, UsersUseCases } from '../../../src/useCases'
import { dbMigration } from '../../utils/dbMigrate'
import { PreconditionError } from '../../utils/error'
import { createMockUser } from '../../utils/mocks'

describe('Admin management', () => {
  let admin: User

  beforeAll(async () => {
    await dbMigration.up()
    admin = await createMockUser()
    await usersRepository
      .updateRole(admin.oauthProvider, admin.oauthUserId, UserRole.Admin)
      .catch(() => {
        throw new PreconditionError('Failed to set admin role')
      })
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  it('should fail role update for non-admin users', async () => {
    const user = await createMockUser()

    await expect(
      UsersUseCases.updateRole(user, user, UserRole.Admin),
    ).rejects.toThrow('User does not have admin privileges')
  })

  it('should successfully update role for admin users', async () => {
    const user = await createMockUser()
    await UsersUseCases.updateRole(admin, user, UserRole.User)

    const updatedUser = await usersRepository.getUserByOAuthInformation(
      user.oauthProvider,
      user.oauthUserId,
    )
    expect(updatedUser?.role).toBe(UserRole.User)
  })

  it('should throw an error when trying to update role to an invalid role', async () => {
    const user = await createMockUser()

    await expect(
      UsersUseCases.updateRole(admin, user, 'INVALID_ROLE' as UserRole),
    ).rejects.toThrow('Invalid role')
  })

  it('should throw an error when trying to update subscription for non-admin users', async () => {
    const user = await createMockUser()

    await expect(
      SubscriptionsUseCases.updateSubscription(user, user, 'monthly', 100, 100),
    ).rejects.toThrow('User does not have admin privileges')
  })

  it('should successfully update subscription for admin users', async () => {
    const user = await createMockUser()

    await SubscriptionsUseCases.updateSubscription(
      admin,
      user,
      'monthly',
      100,
      100,
    )
  })
})
