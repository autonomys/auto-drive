import { jest } from '@jest/globals'
import { UsersUseCases } from '../src/useCases/users.js'
import { UnonboardedUser, UserRole } from '@auto-drive/models'
import { OrganizationsUseCases } from '../src/useCases/organizations.js'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { dbMigration } from './utils/dbMigrate.js'
import { organizationMembersRepository } from '../src/repositories/organizationMembers.js'
import { organizationsRepository } from '../src/repositories/organizations.js'
import { createUnonboardedUser, MOCK_UNONBOARDED_USER } from './utils/mocks.js'

describe('UsersUseCases', () => {
  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
  })

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
  })

  it('should return unonboarded user info', async () => {
    const nonOnboardedUser: UnonboardedUser = {
      oauthProvider: 'google',
      oauthUserId: 'non-onboarded-user',
      role: UserRole.User,
      publicId: null,
      onboarded: false,
    }

    await expect(
      UsersUseCases.getUserWithOrganization(nonOnboardedUser),
    ).resolves.toMatchObject(nonOnboardedUser)
  })

  it('should get user info for an onboarded user', async () => {
    const user = createUnonboardedUser()

    const onboardedUser = await UsersUseCases.onboardUser(user)
    if (!onboardedUser) {
      expect(onboardedUser).toBeTruthy()
      return
    }

    const userInfo = await UsersUseCases.getUserWithOrganization(onboardedUser)

    expect(userInfo).toMatchObject({
      onboarded: true,
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
      role: UserRole.User,
      organizationId: expect.any(String),
    })
  })

  // `/@me` relies on this to pass the API key on to the backend.
  it('should keep the API key that authenticated the request', async () => {
    const onboardedUser = await UsersUseCases.onboardUser(
      createUnonboardedUser(),
    )
    if (!onboardedUser) {
      expect(onboardedUser).toBeTruthy()
      return
    }

    const authenticated = { ...onboardedUser, apiKeyId: 'k1' }
    const userInfo = await UsersUseCases.getUserWithOrganization(authenticated)

    expect(userInfo).toMatchObject({ apiKeyId: 'k1' })
  })

  it('should onboard a user', async () => {
    const user = await UsersUseCases.onboardUser(MOCK_UNONBOARDED_USER)

    if (!user) {
      expect(user).toBeTruthy()
      return
    }

    expect(user.onboarded).toBe(true)
    expect(user.publicId).not.toBeNull()
    expect(user.role).toBe(UserRole.User)
    expect(user.oauthProvider).toBe(MOCK_UNONBOARDED_USER.oauthProvider)
    expect(user.oauthUserId).toBe(MOCK_UNONBOARDED_USER.oauthUserId)
    expect(user.oauthUsername).toBe(MOCK_UNONBOARDED_USER.oauthUsername)
    expect(user.oauthAvatarUrl).toBe(MOCK_UNONBOARDED_USER.oauthAvatarUrl)

    const userByPublicId = await UsersUseCases.getUserByPublicId(user.publicId!)

    expect(userByPublicId).toEqual(user)
  })

  it('user should have an organization linked to a subscription', async () => {
    const user = await UsersUseCases.getUserByOAuthUser({
      provider: MOCK_UNONBOARDED_USER.oauthProvider,
      id: MOCK_UNONBOARDED_USER.oauthUserId,
    })

    if (!user.onboarded) {
      expect(user.onboarded).toBeTruthy()
      return
    }

    const promise = OrganizationsUseCases.getOrganizationByUser(user)
    await expect(promise).resolves.toBeTruthy()

    const organization = await promise
    expect(organization).toEqual({
      id: expect.any(String),
      name: expect.any(String),
    })
  })

  describe('organization membership', () => {
    const onboard = async () => {
      const user = await UsersUseCases.onboardUser(createUnonboardedUser())
      if (!user) throw new Error('Failed to onboard user')
      return user
    }

    it('names the personal organization without the public ID', async () => {
      const user = await onboard()

      const organization =
        await OrganizationsUseCases.getOrganizationByUser(user)

      expect(organization.name).toBe('Personal')
    })

    it('rejects a second membership for the same user', async () => {
      const user = await onboard()
      const other = await onboard()
      const otherOrganization =
        await OrganizationsUseCases.getOrganizationByUser(other)

      await expect(
        organizationMembersRepository.addMemberToOrganization(
          otherOrganization.id,
          user.oauthProvider,
          user.oauthUserId,
        ),
      ).rejects.toThrow(/users_organizations_user_key/)
    })

    it('does not keep a user whose organization could not be created', async () => {
      const unonboarded = createUnonboardedUser()
      jest
        .spyOn(organizationsRepository, 'createOrganization')
        .mockRejectedValueOnce(new Error('connection lost'))

      await expect(UsersUseCases.onboardUser(unonboarded)).rejects.toThrow(
        'connection lost',
      )

      // The user row was rolled back, so the next sign-in onboards them.
      const user = await UsersUseCases.onboardUser(unonboarded)
      if (!user) throw new Error('Failed to onboard user')
      const organization =
        await OrganizationsUseCases.getOrganizationByUser(user)
      expect(organization.name).toBe('Personal')
    })

    it('resolves the same organization one by one and in a batch', async () => {
      const users = await Promise.all([onboard(), onboard()])

      const batch = await UsersUseCases.getUsersWithOrganizations(
        users.map((u) => u.publicId),
      )

      for (const user of users) {
        const organization =
          await OrganizationsUseCases.getOrganizationByUser(user)
        expect(
          batch.find((u) => u.publicId === user.publicId)?.organizationId,
        ).toBe(organization.id)
      }
    })
  })

  // it("should be able to get user list", async () => {
  //   const user = await createMockUser();
  //   await usersRepository.updateRole(
  //     user.oauthProvider,
  //     user.oauthUserId,
  //     UserRole.Admin
  //   );

  //   const users = await UsersUseCases.getUserList(user);
  //   expect(users).toBeInstanceOf(Array);
  // });
})
