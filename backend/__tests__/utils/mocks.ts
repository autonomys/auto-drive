import {
  UnonboardedUser,
  UserRole,
  UserWithOrganization,
} from '../../src/models/users'
import { v4 } from 'uuid'

export const MOCK_UNONBOARDED_USER: UnonboardedUser = {
  oauthProvider: 'google',
  oauthUserId: '123',
  role: UserRole.User,
  publicId: null,
  onboarded: false,
}

export const createMockUser = (): UserWithOrganization => {
  return {
    ...MOCK_UNONBOARDED_USER,
    onboarded: true,
    organizationId: v4(),
    publicId: v4(),
  }
}
