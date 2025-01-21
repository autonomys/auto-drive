import { config } from '../../config.js'
import { UserWithOrganization } from '../../models/users/index.js'

const getUserFromAccessToken = async (
  provider: string,
  accessToken: string,
): Promise<UserWithOrganization> => {
  const response = await fetch(`${config.authService.url}/users/@me`, {
    headers: {
      'x-auth-provider': provider,
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch user')
  }

  return response.json()
}

const getUserFromPublicId = async (
  publicId: string,
): Promise<UserWithOrganization> => {
  const response = await fetch(`${config.authService.url}/users/${publicId}`, {
    headers: {
      Authorization: `Bearer ${config.authService.token}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch user')
  }

  return response.json()
}

export const AuthManager = {
  getUserFromAccessToken,
  getUserFromPublicId,
}
