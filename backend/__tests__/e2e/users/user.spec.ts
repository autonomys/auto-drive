import { UsersUseCases } from '../../../src/useCases/users/users.js'
import { UnonboardedUser, UserRole } from '../../../src/models/users/user.js'
import { OrganizationsUseCases } from '../../../src/useCases/users/organizations.js'
import { SubscriptionsUseCases } from '../../../src/useCases/users/subscriptions.js'
import { subscriptionsRepository } from '../../../src/repositories/index.js'
import { closeDatabase, getDatabase } from '../../../src/drivers/pg.js'
import { dbMigration } from '../../utils/dbMigrate.js'

export const MOCK_UNONBOARDED_USER: UnonboardedUser = {
  oauthProvider: 'google',
  oauthUserId: '123',
  role: UserRole.User,
  publicId: null,
  onboarded: false,
}

describe('UsersUseCases', () => {
  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
  })

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
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
})
