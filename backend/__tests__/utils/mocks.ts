import { UserRole, UserWithOrganization } from '../../src/models/users'
import { v4 } from 'uuid'

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
