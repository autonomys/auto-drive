import { err, ok, Result } from 'neverthrow'
import { getAddress, isAddress } from 'viem'
import {
  Account,
  OrganizationRole,
  PartnerEndUser,
  SERVICE_USER_PROVIDER,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import {
  AuthManager,
  OrganizationRequestError,
  PartnerEndUserEnrollment,
} from '../../infrastructure/services/auth/index.js'
import { BadRequestError, ForbiddenError } from '../../errors/index.js'
import { getPartnerAccount } from './organizations.js'
import { sendEndUserMetric } from './endUserQuota.js'
import { accountsRepository } from '../../infrastructure/repositories/users/accounts.js'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('core:endUsers')

type EndUsersError = ForbiddenError | OrganizationRequestError

export type EndUserInput = {
  address: string
  customerReference: string
  uploadQuotaBytes?: number | null
}

// The address in EIP-55 form, the form wallet sign-in uses, or null if it is
// not an address. Mixed case must be a valid checksum.
const normaliseAddress = (address: string): string | null =>
  isAddress(address) ? getAddress(address) : null

/**
 * A partner organisation's end users are managed by its own organisation API
 * key (one limited to scopes needs end_user_enrollment to enrol and change
 * quotas and end_user_removal to remove, which the routes require) and by its
 * organisation admins, signed in. Auto Drive admins, signed in, may list
 * and remove them but not enrol them or change their quotas. Every other
 * caller is refused, personal API keys and other organisations' keys
 * included. Returns the partner's account.
 */
const authorize = async (
  executor: UserWithOrganization,
  organizationId: string,
  action: 'enroll' | 'list' | 'remove',
): Promise<Result<Account, EndUsersError>> => {
  const isOwnKey =
    executor.oauthProvider === SERVICE_USER_PROVIDER &&
    executor.oauthUserId === organizationId
  const signedIn = !executor.apiKeyId
  const isMember = signedIn && executor.organizationId === organizationId
  const isAutoDriveAdmin =
    signedIn && executor.role === UserRole.Admin && action !== 'enroll'
  if (!isOwnKey && !isMember && !isAutoDriveAdmin) {
    return err(
      new ForbiddenError(
        'Not allowed to manage the end users of this organization',
      ),
    )
  }

  const partnerAccount = await getPartnerAccount(organizationId)
  if (partnerAccount.isErr()) return err(partnerAccount.error)
  if (isOwnKey || isAutoDriveAdmin) return ok(partnerAccount.value)

  return (await isOrganizationAdmin(executor, organizationId)).andThen(
    (isAdmin) =>
      isAdmin
        ? ok(partnerAccount.value)
        : err(
            new ForbiddenError(
              'Only organization admins can manage its end users',
            ),
          ),
  )
}

// Whether the user is an admin of the organisation. The member list leaves
// out end users, so it stays small.
const isOrganizationAdmin = async (
  user: UserWithOrganization,
  organizationId: string,
): Promise<Result<boolean, OrganizationRequestError>> => {
  const organization = await AuthManager.getOrganization(organizationId)
  if (organization.isErr()) return err(organization.error)
  return ok(
    organization.value.memberships.some(
      (m) => m.publicId === user.publicId && m.role === OrganizationRole.Admin,
    ),
  )
}

// A quota may be at most the account's per-person maximum.
const checkQuota = (
  account: Account,
  uploadQuotaBytes: number | null,
): Result<void, BadRequestError> =>
  uploadQuotaBytes !== null && uploadQuotaBytes > account.maxEndUserQuotaBytes
    ? err(
        new BadRequestError(
          `uploadQuotaBytes ${uploadQuotaBytes} is above the organization's ` +
            `per-person maximum of ${account.maxEndUserQuotaBytes} bytes, ` +
            'which its admins set',
        ),
      )
    : ok()

/**
 * Enrols end users. The auth service owns them: it enrols all of them or none
 * in one transaction, returns an end user already enrolled with the same
 * customer reference and quota unchanged and enrols a removed one again under
 * the same reference, so a request that failed or timed out can be retried.
 * It also checks the cap, and records the API key behind each change.
 */
const enrollEndUsers = async (
  executor: UserWithOrganization,
  organizationId: string,
  inputs: EndUserInput[],
): Promise<Result<PartnerEndUser[], EndUsersError>> => {
  const allowed = await authorize(executor, organizationId, 'enroll')
  if (allowed.isErr()) return err(allowed.error)

  const requested: PartnerEndUserEnrollment[] = []
  for (const input of inputs) {
    const address = normaliseAddress(input.address)
    if (!address) {
      return err(new BadRequestError(`Invalid address: ${input.address}`))
    }
    const uploadQuotaBytes = input.uploadQuotaBytes ?? null
    const quota = checkQuota(allowed.value, uploadQuotaBytes)
    if (quota.isErr()) return err(quota.error)
    requested.push({
      address,
      customerReference: input.customerReference,
      uploadQuotaBytes,
    })
  }
  const addresses = requested.map((r) => r.address)
  const references = requested.map((r) => r.customerReference)
  if (
    new Set(addresses).size < addresses.length ||
    new Set(references).size < references.length
  ) {
    return err(
      new BadRequestError(
        'Each address and customer reference may appear only once',
      ),
    )
  }

  const enrolled = await AuthManager.enrollOrganizationEndUsers(
    organizationId,
    requested,
    config.params.partnerMaxEndUsers,
    executor.publicId,
    executor.apiKeyId ?? null,
  )
  if (enrolled.isErr()) return err(enrolled.error)

  logger.info('End users enrolled', {
    organizationId,
    count: requested.length,
    by: executor.publicId,
  })
  // Retries included.
  sendEndUserMetric(organizationId, 'enrolled', { count: requested.length })
  return ok(enrolled.value)
}

/**
 * Sets an active end user's upload quota, at most the account's per-person
 * maximum, or with null makes them follow the maximum. Auth records the
 * change; setting the quota they have changes nothing, so a retry is safe.
 */
const setEndUserQuota = async (
  executor: UserWithOrganization,
  organizationId: string,
  address: string,
  uploadQuotaBytes: number | null,
): Promise<Result<PartnerEndUser, EndUsersError>> => {
  const allowed = await authorize(executor, organizationId, 'enroll')
  if (allowed.isErr()) return err(allowed.error)

  const normalised = normaliseAddress(address)
  if (!normalised) {
    return err(new BadRequestError(`Invalid address: ${address}`))
  }
  const quota = checkQuota(allowed.value, uploadQuotaBytes)
  if (quota.isErr()) return err(quota.error)

  const updated = await AuthManager.setOrganizationEndUserQuota(
    organizationId,
    normalised,
    uploadQuotaBytes,
    executor.publicId,
    executor.apiKeyId ?? null,
  )
  if (updated.isErr()) return err(updated.error)

  logger.info('End user quota set', {
    organizationId,
    address: normalised,
    uploadQuotaBytes,
    by: executor.publicId,
  })
  return ok(updated.value)
}

/**
 * Sets the most any one of the organisation's end users may upload in total.
 * Only its admins, signed in, may: no API key can, so a leaked one can't raise
 * what each identity it enrols may spend. Lowering it applies at once to
 * everyone already enrolled.
 */
const setMaxEndUserQuota = async (
  executor: UserWithOrganization,
  organizationId: string,
  maxEndUserQuotaBytes: number,
): Promise<Result<{ maxEndUserQuotaBytes: number }, EndUsersError>> => {
  const refused = () =>
    err(
      new ForbiddenError(
        'Only organization admins, signed in, can set the per-person maximum',
      ),
    )
  if (executor.apiKeyId || executor.organizationId !== organizationId) {
    return refused()
  }
  const partnerAccount = await getPartnerAccount(organizationId)
  if (partnerAccount.isErr()) return err(partnerAccount.error)
  const isAdmin = await isOrganizationAdmin(executor, organizationId)
  if (isAdmin.isErr()) return err(isAdmin.error)
  if (!isAdmin.value) return refused()

  const account = await accountsRepository.setMaxEndUserQuota(
    partnerAccount.value.id,
    maxEndUserQuotaBytes,
    executor.publicId,
  )
  logger.info('Per-person maximum set', {
    organizationId,
    maxEndUserQuotaBytes,
    by: executor.publicId,
  })
  return ok({ maxEndUserQuotaBytes: account.maxEndUserQuotaBytes })
}

/**
 * Removes an end user. They stay in the organisation, read-only, and keep
 * their files. Removing someone already removed succeeds, so a retry is safe.
 */
const removeEndUser = async (
  executor: UserWithOrganization,
  organizationId: string,
  address: string,
): Promise<Result<void, EndUsersError>> => {
  const allowed = await authorize(executor, organizationId, 'remove')
  if (allowed.isErr()) return err(allowed.error)

  const normalised = normaliseAddress(address)
  if (!normalised) {
    return err(new BadRequestError(`Invalid address: ${address}`))
  }

  const removed = await AuthManager.removeOrganizationEndUser(
    organizationId,
    normalised,
    executor.publicId,
    executor.apiKeyId ?? null,
  )
  if (removed.isErr()) return err(removed.error)

  logger.info('End user removed', {
    organizationId,
    address: normalised,
    by: executor.publicId,
  })
  return ok()
}

// A page of the end users, removed ones included, in the order of enrollment.
const listEndUsers = async (
  executor: UserWithOrganization,
  organizationId: string,
  page: { limit: number; offset: number },
): Promise<
  Result<{ endUsers: PartnerEndUser[]; totalCount: number }, EndUsersError>
> => {
  const allowed = await authorize(executor, organizationId, 'list')
  if (allowed.isErr()) return err(allowed.error)

  return AuthManager.listOrganizationEndUsers(organizationId, page)
}

export const EndUsersUseCases = {
  enrollEndUsers,
  setEndUserQuota,
  setMaxEndUserQuota,
  removeEndUser,
  listEndUsers,
}
