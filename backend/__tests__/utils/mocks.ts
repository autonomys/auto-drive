import { Rabbit } from '../../src/drivers/rabbit.js'
import { jest } from '@jest/globals'
import { UserRole, UserWithOrganization } from '@auto-drive/models'
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

export const mockRabbitPublish = (): jest.SpiedFunction<
  typeof Rabbit.publish
> => {
  const mock = jest.spyOn(Rabbit, 'publish')

  mock.mockImplementation(() => Promise.resolve())

  return mock
}

export const unmockMethods = () => {
  jest.restoreAllMocks()
}
