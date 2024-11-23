import { UsersUseCases } from '../../../src/useCases/users/users.js'
import { UnonboardedUser, UserRole } from '../../../src/models/users/user.js'
import { OrganizationsUseCases } from '../../../src/useCases/users/organizations.js'
import { SubscriptionsUseCases } from '../../../src/useCases/users/subscriptions.js'
import {
  subscriptionsRepository,
  usersRepository,
} from '../../../src/repositories/index.js'
import { closeDatabase, getDatabase } from '../../../src/drivers/pg.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { createMockUser, MOCK_UNONBOARDED_USER } from '../../utils/mocks.js'

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
      UsersUseCases.getUserInfo(nonOnboardedUser),
    ).resolves.toMatchObject({
      user: nonOnboardedUser,
    })
  })

  it('should get user info for an onboarded user', async () => {
    const user = await createMockUser()

    const userInfo = await UsersUseCases.getUserInfo(user)
    expect(userInfo.user).toMatchObject({
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
      role: UserRole.User,
    })
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

    const userByPublicId = await UsersUseCases.getUserByPublicId(user.publicId!)

    expect(userByPublicId).toEqual(user)
  })

  it('user should have a subscription', async () => {
    const user = await UsersUseCases.getUserByOAuthUser({
      provider: MOCK_UNONBOARDED_USER.oauthProvider,
      id: MOCK_UNONBOARDED_USER.oauthUserId,
    })

    expect(user).toBeTruthy()

    const promise = SubscriptionsUseCases.getSubscription(user!.publicId)

    await expect(promise).resolves.toEqual(
      expect.objectContaining({
        id: expect.any(String),
        organizationId: expect.any(String),
        uploadLimit: expect.any(Number),
        downloadLimit: expect.any(Number),
        granularity: expect.any(String),
      }),
    )
  })

  it('user should have an organization linked to a subscription', async () => {
    const user = await UsersUseCases.getUserByOAuthUser({
      provider: MOCK_UNONBOARDED_USER.oauthProvider,
      id: MOCK_UNONBOARDED_USER.oauthUserId,
    })

    const promise = OrganizationsUseCases.getOrganizationByUser(user)
    await expect(promise).resolves.toBeTruthy()

    const organization = await promise
    expect(organization).toEqual({
      id: expect.any(String),
      name: expect.any(String),
    })

    const subscription = await subscriptionsRepository.getByOrganizationId(
      organization.id,
    )

    expect(subscription).toBeTruthy()
  })

  it('should be able to get user list', async () => {
    const user = await createMockUser()
    await usersRepository.updateRole(
      user.oauthProvider,
      user.oauthUserId,
      UserRole.Admin,
    )

    const users = await UsersUseCases.getUserList(user)
    expect(users).toBeInstanceOf(Array)
  })
})
