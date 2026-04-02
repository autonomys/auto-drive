import { config } from '../../../config.js'
import { DeletionRequest, UserWithOrganization } from '@auto-drive/models'

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

const getUsersFromPublicIds = async (
  publicIds: string[],
): Promise<UserWithOrganization[]> => {
  if (publicIds.length === 0) return []

  const response = await fetch(`${config.authService.url}/users/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.authService.token}`,
    },
    body: JSON.stringify({ publicIds }),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch users')
  }

  return response.json()
}

const getDeletionRequestsDue = async (): Promise<DeletionRequest[]> => {
  const response = await fetch(
    `${config.authService.url}/users/admin/deletions/due`,
    {
      headers: {
        Authorization: `Bearer ${config.authService.token}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error('Failed to fetch due deletion requests')
  }

  return response.json()
}

const markDeletionAsProcessing = async (
  requestId: string,
): Promise<DeletionRequest | null> => {
  const response = await fetch(
    `${config.authService.url}/users/admin/deletions/${requestId}/process`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.authService.token}`,
      },
    },
  )

  // 404/409 means the request is no longer pending (race with another worker)
  if (response.status === 404 || response.status === 409) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to mark deletion ${requestId} as processing`)
  }

  return response.json()
}

const executeAuthAnonymisation = async (
  requestId: string,
): Promise<void> => {
  const response = await fetch(
    `${config.authService.url}/users/admin/deletions/${requestId}/anonymise`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.authService.token}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error(`Failed to anonymise user for deletion ${requestId}`)
  }
}

const markDeletionAsCompleted = async (
  requestId: string,
): Promise<DeletionRequest> => {
  const response = await fetch(
    `${config.authService.url}/users/admin/deletions/${requestId}/complete`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.authService.token}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error(`Failed to mark deletion ${requestId} as completed`)
  }

  return response.json()
}

const markDeletionAsFailed = async (
  requestId: string,
  adminNotes?: string,
): Promise<DeletionRequest> => {
  const response = await fetch(
    `${config.authService.url}/users/admin/deletions/${requestId}/fail`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.authService.token}`,
      },
      body: JSON.stringify({ adminNotes }),
    },
  )

  if (!response.ok) {
    throw new Error(`Failed to mark deletion ${requestId} as failed`)
  }

  return response.json()
}

export const AuthManager = {
  getUserFromAccessToken,
  getUserFromPublicId,
  getUsersFromPublicIds,
  getDeletionRequestsDue,
  markDeletionAsProcessing,
  executeAuthAnonymisation,
  markDeletionAsCompleted,
  markDeletionAsFailed,
}
