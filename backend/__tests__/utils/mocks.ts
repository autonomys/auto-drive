import { UnonboardedUser, User, UserRole } from '../../src/models/users'
import { faker } from '@faker-js/faker'
import { UsersUseCases } from '../../src/useCases'
import { PreconditionError } from './error'

export const MOCK_UNONBOARDED_USER: UnonboardedUser = {
  oauthProvider: 'google',
  oauthUserId: '123',
  role: UserRole.User,
  publicId: null,
  onboarded: false,
}

export const createMockUser = async (): Promise<User> => {
  const user: UnonboardedUser = {
    oauthProvider: 'google',
    oauthUserId: faker.string.uuid(),
    role: UserRole.Admin,
    publicId: null,
    onboarded: false,
  }

  const onboardUser = await UsersUseCases.onboardUser(user)
  if (!onboardUser) {
    throw new PreconditionError('Failed to onboard user')
  }

  return onboardUser
}
