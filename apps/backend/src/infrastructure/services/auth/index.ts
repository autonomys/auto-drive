import { createHash } from 'crypto'
import { LRUCache } from 'lru-cache'
import { config } from '../../../config.js'
import {
  ApiKey,
  ApiKeyName,
  ApiKeyWithoutSecret,
  CreateApiKeyInput,
  DeletionRequest,
  MaybeUserWithOrganization,
  Organization,
  OrganizationMembershipChange,
  OrganizationRole,
  OrganizationSummary,
  OrganizationWithMembers,
  PartnerEndUser,
  PartnerOrigin,
  UserWithOrganization,
} from '@auto-drive/models'
import { err, ok, Result } from 'neverthrow'
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../../errors/index.js'

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

/**
 * The users behind session tokens, for 60 seconds. An upload arrives as 1 MiB
 * chunks, one request each, and without this every chunk waits on the auth
 * service.
 *
 * API keys aren't cached, so revoking one applies from the next request. For a
 * session, signing out or a change made outside this process, such as a
 * partner removing an end user or changing their quota, applies within 60
 * seconds. Membership changes made through this process apply at once.
 */
const sessionCache = new LRUCache<string, UserWithOrganization>({
  max: 10_000,
  ttl: 60_000,
})

/** Drops a user's cached sessions after a change to their membership. */
const forgetSessions = (publicId: string) => {
  const keys = [...sessionCache.entries()]
    .filter(([, user]) => user.publicId === publicId)
    .map(([key]) => key)
  keys.forEach((key) => sessionCache.delete(key))
}

const getUserFromAccessToken = async (
  provider: string,
  accessToken: string,
): Promise<UserWithOrganization> => {
  if (provider === 'apikey') return lookUpUser(provider, accessToken)

  const key = `${provider}:${createHash('sha256').update(accessToken).digest('hex')}`
  const cached = sessionCache.get(key)
  if (cached) return cached

  const user = await lookUpUser(provider, accessToken)
  // Users who haven't accepted the Terms do so with the auth service directly,
  // which this process wouldn't hear about.
  if (user.onboarded) sessionCache.set(key, user)
  return user
}

const lookUpUser = async (
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

/** Names of API keys, deleted ones included, for usage reports. */
const getApiKeyNames = async (ids: string[]): Promise<ApiKeyName[]> => {
  const names: ApiKeyName[] = []
  // The auth service takes up to 100 IDs at a time.
  for (let i = 0; i < ids.length; i += 100) {
    const response = await fetch(`${config.authService.url}/users/apiKeys/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.authService.token}`,
      },
      body: JSON.stringify({ ids: ids.slice(i, i + 100) }),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch API key names (${response.status})`)
    }

    names.push(...((await response.json()) as ApiKeyName[]))
  }
  return names
}

/**
 * Admin search: users whose publicId contains `query`, plus the members of
 * `organizationId` when given.
 */
const adminSearchUsers = async (
  query: string,
  organizationId?: string,
): Promise<MaybeUserWithOrganization[]> => {
  const params = new URLSearchParams({ q: query })
  if (organizationId) params.set('organizationId', organizationId)

  const response = await fetch(
    `${config.authService.url}/users/admin/search?${params}`,
    {
      headers: {
        Authorization: `Bearer ${config.authService.token}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error('Failed to search users')
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

export type OrganizationRequestError =
  | BadRequestError
  | NotFoundError
  | ConflictError
  | ServiceUnavailableError

/**
 * A call to the auth service's organization endpoints. Those answer 400, 404
 * and 409 with a message meant for the admin, and 503 when a change kept
 * conflicting with concurrent ones and can be sent again; these are passed on.
 * Any other failure is the auth service's and throws.
 */
const organizationRequest = async <T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Result<T, OrganizationRequestError>> => {
  const response = await fetch(`${config.authService.url}/organizations${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${config.authService.token}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

  if (response.ok) {
    return ok(response.status === 204 ? (undefined as T) : await response.json())
  }

  const message = await response
    .json()
    .then((body: { error?: string }) => body.error)
    .catch(() => undefined)
  const errorMessage = message ?? response.statusText
  switch (response.status) {
    case 400:
      return err(new BadRequestError(errorMessage))
    case 404:
      return err(new NotFoundError(errorMessage))
    case 409:
      return err(new ConflictError(errorMessage))
    case 503:
      return err(new ServiceUnavailableError(errorMessage))
    default:
      throw new Error(
        `Auth organization request failed (${response.status}): ${errorMessage}`,
      )
  }
}

const createOrganization = (name: string) =>
  organizationRequest<Organization>('/', { method: 'POST', body: { name } })

const getOrganizationSummaries = (ids: string[]) =>
  organizationRequest<OrganizationSummary[]>('/batch', {
    method: 'POST',
    body: { ids },
  })

const getOrganization = (organizationId: string) =>
  organizationRequest<OrganizationWithMembers>(
    `/${encodeURIComponent(organizationId)}`,
  )

const getOrganizationMembershipChanges = (organizationId: string) =>
  organizationRequest<OrganizationMembershipChange[]>(
    `/${encodeURIComponent(organizationId)}/membership-changes`,
  )

const addOrganizationMember = (
  organizationId: string,
  member: { publicId: string; role: OrganizationRole },
  actor: string,
) =>
  organizationRequest<void>(`/${encodeURIComponent(organizationId)}/members`, {
    method: 'POST',
    body: { ...member, actor },
  }).finally(() => forgetSessions(member.publicId))

const changeOrganizationMemberRole = (
  organizationId: string,
  publicId: string,
  role: OrganizationRole,
  actor: string,
) =>
  organizationRequest<void>(
    `/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(publicId)}`,
    { method: 'PUT', body: { role, actor } },
  ).finally(() => forgetSessions(publicId))

const removeOrganizationMember = (
  organizationId: string,
  publicId: string,
  actor: string,
) =>
  organizationRequest<{ organizationId: string }>(
    `/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(publicId)}`,
    { method: 'DELETE', body: { actor } },
  ).finally(() => forgetSessions(publicId))

export type PartnerEndUserEnrollment = {
  address: string
  customerReference: string
  uploadQuotaBytes: number | null
}

// Enrolls them in one transaction, at most maxEndUsers end users that are not
// removed in all, and returns them in request order.
// `actor` is who made the change; `actorApiKeyId` the organisation API key
// they made it with, if any.
const enrollOrganizationEndUsers = (
  organizationId: string,
  endUsers: PartnerEndUserEnrollment[],
  maxEndUsers: number,
  actor: string,
  actorApiKeyId: string | null,
) =>
  organizationRequest<PartnerEndUser[]>(
    `/${encodeURIComponent(organizationId)}/end-users`,
    {
      method: 'POST',
      body: { endUsers, maxEndUsers, actor, actorApiKeyId },
    },
  )

const listOrganizationEndUsers = (
  organizationId: string,
  { limit, offset }: { limit: number; offset: number },
) =>
  organizationRequest<{ endUsers: PartnerEndUser[]; totalCount: number }>(
    `/${encodeURIComponent(organizationId)}/end-users?limit=${limit}&offset=${offset}`,
  )

// Succeeds for an end user already removed.
const removeOrganizationEndUser = (
  organizationId: string,
  address: string,
  actor: string,
  actorApiKeyId: string | null,
) =>
  organizationRequest<void>(
    `/${encodeURIComponent(organizationId)}/end-users/${encodeURIComponent(address)}`,
    { method: 'DELETE', body: { actor, actorApiKeyId } },
  )

const listPartnerOrigins = (organizationId: string) =>
  organizationRequest<PartnerOrigin[]>(
    `/${encodeURIComponent(organizationId)}/partner-origins`,
  )

const addPartnerOrigin = (
  organizationId: string,
  origin: string,
  actor: string,
) =>
  organizationRequest<PartnerOrigin>(
    `/${encodeURIComponent(organizationId)}/partner-origins`,
    { method: 'POST', body: { origin, actor } },
  )

// Refused while the organisation has end users, who sign in only through its
// origins.
const removePartnerOrigin = (organizationId: string, origin: string) =>
  organizationRequest<void>(
    `/${encodeURIComponent(organizationId)}/partner-origins?${new URLSearchParams({ origin })}`,
    { method: 'DELETE' },
  )

const getOrganizationApiKeys = (organizationId: string) =>
  organizationRequest<ApiKeyWithoutSecret[]>(
    `/${encodeURIComponent(organizationId)}/apiKeys`,
  )

const createOrganizationApiKey = (
  organizationId: string,
  input: CreateApiKeyInput,
) =>
  organizationRequest<ApiKey>(`/${encodeURIComponent(organizationId)}/apiKeys`, {
    method: 'POST',
    body: input,
  })

const revokeOrganizationApiKey = (organizationId: string, apiKeyId: string) =>
  organizationRequest<void>(
    `/${encodeURIComponent(organizationId)}/apiKeys/${encodeURIComponent(apiKeyId)}`,
    { method: 'DELETE' },
  )

export const AuthManager = {
  getApiKeyNames,
  getOrganizationApiKeys,
  createOrganizationApiKey,
  revokeOrganizationApiKey,
  createOrganization,
  getOrganizationSummaries,
  getOrganization,
  getOrganizationMembershipChanges,
  addOrganizationMember,
  changeOrganizationMemberRole,
  removeOrganizationMember,
  enrollOrganizationEndUsers,
  listOrganizationEndUsers,
  removeOrganizationEndUser,
  listPartnerOrigins,
  addPartnerOrigin,
  removePartnerOrigin,
  getUserFromAccessToken,
  getUserFromPublicId,
  getUsersFromPublicIds,
  adminSearchUsers,
  getDeletionRequestsDue,
  markDeletionAsProcessing,
  executeAuthAnonymisation,
  markDeletionAsCompleted,
  markDeletionAsFailed,
}
