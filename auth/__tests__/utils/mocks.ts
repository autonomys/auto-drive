import {
  UnonboardedUser,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
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
    oauthProvider: 'google',
    oauthUserId: v4(),
    role: UserRole.User,
    onboarded: true,
    organizationId: v4(),
    publicId: v4(),
  }
}

export const createMockAdmin = (): UserWithOrganization => {
  return {
    ...createMockUser(),
    role: UserRole.Admin,
  }
}

export const createUnonboardedUser = (): UnonboardedUser => {
  return {
    ...MOCK_UNONBOARDED_USER,
    oauthUserId: v4(),
  }
}
