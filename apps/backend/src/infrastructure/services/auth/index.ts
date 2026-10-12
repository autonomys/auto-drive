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
 * (handleAuthIgnoreOnboarding in apps/auth); 403 is the other way it can refuse
 * a caller it did resolve.
 *
 * Deliberately NOT "any 4xx". 408, 425 and 429 mean the service declined to do
 * the work this time, and 404 is what a proxy or ingress answers when the URL
 * itself is wrong — a stale deploy or a renamed route would otherwise report
 * every working key as permanently dead, the exact failure this class exists to
 * prevent, just moved one status along.
 */
const CREDENTIAL_REJECTION_STATUSES = new Set([401, 403])

/**
 * How long to wait for the auth service before treating it as unavailable.
 *
 * Without this, the common outage shape — a service that accepts the connection
 * and then hangs — never produces an error at all: the request holds a worker
 * slot until the client itself gives up, and the retryable 503 path below is
 * unreachable. The timeout turns that hang into an AbortError, which the catch
 * classifies as a service failure.
 */
const AUTH_LOOKUP_TIMEOUT_MS = 10_000

export type AuthFailureKind = 'rejected' | 'unavailable'

/**
 * How to answer a failed token lookup: was the credential refused, or could the
 * question not be answered?
 *
 * Anything that is not an AuthLookupError is a fault in THIS service — a
 * TypeError, a refactor that throws something new — not a verdict on the
 * credential. Those are 'unavailable' so they surface as a 5xx an operator will
 * see, rather than a 403 that blames the caller and fires no alert.
 *
 * Shared so the S3 and REST adapters cannot drift on whether a given failure is
 * worth retrying; each one only decides how to render the answer.
 */
export const classifyAuthFailure = (error: unknown): AuthFailureKind =>
  error instanceof AuthLookupError && error.isCredentialFailure
    ? 'rejected'
    : 'unavailable'

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
      signal: AbortSignal.timeout(AUTH_LOOKUP_TIMEOUT_MS),
    })
  } catch (error) {
    // Transport-level failure or the timeout above: the service never answered,
    // so nothing is known about the credential.
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
