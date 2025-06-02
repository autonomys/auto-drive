import { v4 } from 'uuid'
import { User, UserRole } from '@auto-drive/models'
import { usersRepository } from '../src/repositories/users.js'
import { UsersUseCases } from '../src/useCases/users.js'
import { dbMigration } from './utils/dbMigrate.js'
import { createMockAdmin, createMockUser } from './utils/mocks.js'

describe('Admin management', () => {
  let admin: User

  beforeAll(async () => {
    await dbMigration.up()
    admin = createMockAdmin()
    await UsersUseCases.initUser(
      admin.oauthProvider,
      admin.oauthUserId,
      admin.oauthUsername,
      admin.oauthAvatarUrl,
      v4(),
      UserRole.Admin,
    )
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  it('should fail role update for non-admin users', async () => {
    const user = createMockUser()
    const plainUser = await UsersUseCases.initUser(
      user.oauthProvider,
      user.oauthUserId,
      user.oauthUsername,
      user.oauthAvatarUrl,
      v4(),
      user.role,
    )

    await expect(
      UsersUseCases.updateRole(plainUser, plainUser, UserRole.Admin),
    ).rejects.toThrow('User does not have admin privileges')
  })

  it('should successfully update role for admin users', async () => {
    const user = createMockAdmin()
    await usersRepository.createUser(
      user.oauthProvider,
      user.oauthUserId,
      user.oauthUsername,
      user.oauthAvatarUrl,
      v4(),
      user.role,
    )

    await UsersUseCases.updateRole(admin, user, UserRole.User)

    const updatedUser = await usersRepository.getUserByOAuthInformation(
      user.oauthProvider,
      user.oauthUserId,
    )
    expect(updatedUser?.role).toBe(UserRole.User)
  })

  it('should throw an error when trying to update role to an invalid role', async () => {
    const user = createMockUser()

    await expect(
      UsersUseCases.updateRole(admin, user, 'INVALID_ROLE' as UserRole),
    ).rejects.toThrow('Invalid role')
  })
})
