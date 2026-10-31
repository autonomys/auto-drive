import { v4 } from 'uuid'
import { User, UserRole, deriveUserPublicId } from '@auto-drive/models'
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

describe('deriveUserPublicId', () => {
  it('matches the value previously derived with a Buffer namespace', () => {
    // Fixed fixture: every stored publicId was derived this way, so the
    // shared (browser-safe) implementation must not change the output.
    expect(deriveUserPublicId('google', '1234567890')).toBe(
      'c7e8919b-fb8a-5559-a2eb-fea390a9b89f',
    )
  })
})

describe('Admin user search', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  const initMockUser = async () => {
    const user = createMockUser()
    return UsersUseCases.initUser(
      user.oauthProvider,
      user.oauthUserId,
      user.oauthUsername,
      user.oauthAvatarUrl,
      deriveUserPublicId(user.oauthProvider, user.oauthUserId),
      user.role,
    )
  }

  it('finds users by a partial publicId', async () => {
    const user = await initMockUser()
    const fragment = user.publicId!.slice(4, 16).toUpperCase()

    const results = await UsersUseCases.adminSearchUsers(fragment)

    expect(results.map((u) => u.publicId)).toContain(user.publicId)
    const match = results.find((u) => u.publicId === user.publicId)
    expect(match?.organizationId).toBeTruthy()
  })

  it('treats LIKE wildcards in the query literally', async () => {
    await initMockUser()

    const results = await UsersUseCases.adminSearchUsers('%')

    expect(results).toHaveLength(0)
  })

  it('returns the members of an organization', async () => {
    const user = await initMockUser()
    const { organizationId } =
      await UsersUseCases.getUserWithOrganization(user)

    const results = await UsersUseCases.adminSearchUsers(
      'no-such-public-id',
      organizationId!,
    )

    expect(results.map((u) => u.publicId)).toEqual([user.publicId])
  })
})
