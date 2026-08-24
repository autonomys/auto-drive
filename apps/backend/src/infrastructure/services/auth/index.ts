import { config } from '../../../config.js'
import { DeletionRequest, UserWithOrganization } from '@auto-drive/models'

/**
 * A token lookup against the auth service did not yield a user.
 *
 * `isCredentialFailure` separates the two cases a caller must answer
 * differently, because they call for opposite client behaviour:
 *  - true  — the auth service judged the credential and refused it. Permanent;
 *            retrying it can never succeed.
 *  - false — the auth service never judged it (it was overloaded, timed out,
 *            failed, or could not be reached). Transient; the same credential
 *            may work moments later.
 *
 * Collapsing the two (the previous behaviour: one bare Error for both) forces
 * every caller to answer 500, which S3 clients and rclone classify as
 * retryable — so a permanently-bad API key is retried with backoff instead of
 * failing fast.
 */
export class AuthLookupError extends Error {
  constructor(
    message: string,
    public readonly isCredentialFailure: boolean,
    public readonly upstreamStatus?: number,
  ) {
    super(message)
    this.name = 'AuthLookupError'
  }
}

/**
 * The statuses that are a verdict on the credential itself. The auth service
 * answers 401 for a token or API key it cannot resolve
 * (handleAuthIgnoreOnboarding in apps/auth), and 403/404 are the other two ways
 * it can refuse a caller it did resolve.
 *
 * Deliberately NOT "any 4xx": 408, 425 and 429 all mean the service declined to
 * do the work this time, so reporting them as a bad credential would tell a
 * client its working key is dead — the exact failure this class exists to
 * prevent, just moved one status along.
 */
const CREDENTIAL_REJECTION_STATUSES = new Set([401, 403, 404])

const getUserFromAccessToken = async (
  provider: string,
  accessToken: string,
): Promise<UserWithOrganization> => {
  let response: Response
  try {
    response = await fetch(`${config.authService.url}/users/@me`, {
      headers: {
        'x-auth-provider': provider,
        Authorization: `Bearer ${accessToken}`,
      },
    })
  } catch (error) {
    // Transport-level failure: the service was never reached, so nothing is
    // known about the credential.
    throw new AuthLookupError(
      `Auth service unreachable: ${(error as Error).message}`,
      false,
    )
  }

  if (!response.ok) {
    throw new AuthLookupError(
      `Auth service rejected the token lookup (status=${response.status})`,
      CREDENTIAL_REJECTION_STATUSES.has(response.status),
      response.status,
    )
  }

  try {
    return await response.json()
  } catch (error) {
    // A 200 whose body is not the user (an HTML error page from a proxy, a reset
    // mid-body). The credential was never judged, so this must not be reported
    // as a rejection — a bare SyntaxError here would be, since callers key off
    // AuthLookupError.
    throw new AuthLookupError(
      `Auth service returned an unreadable user: ${(error as Error).message}`,
      false,
      response.status,
    )
  }
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
