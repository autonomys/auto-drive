import { err, ok, Result } from 'neverthrow'
import { getAddress, isAddress } from 'viem'
import {
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
 * key (one limited to scopes needs end_users, which the routes require) and by
 * its organisation admins, signed in. Auto Drive admins, signed in, may list
 * and remove them but not enrol them. Every other caller is refused, personal
 * API keys and other organisations' keys included.
 */
const authorize = async (
  executor: UserWithOrganization,
  organizationId: string,
  action: 'enroll' | 'list' | 'remove',
): Promise<Result<void, EndUsersError>> => {
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
  if (isOwnKey || isAutoDriveAdmin) return ok()

  // The member list leaves out end users, so it stays small.
  const organization = await AuthManager.getOrganization(organizationId)
  if (organization.isErr()) return err(organization.error)
  const isOrganizationAdmin = organization.value.memberships.some(
    (m) =>
      m.publicId === executor.publicId && m.role === OrganizationRole.Admin,
  )
  return isOrganizationAdmin
    ? ok()
    : err(
        new ForbiddenError('Only organization admins can manage its end users'),
      )
}

/**
 * Enrols end users. The auth service owns them: it enrols all of them or none
 * in one transaction, returns an end user already enrolled with the same
 * customer reference unchanged and enrols a removed one again, so a request
 * that failed or timed out can be retried. It also checks the cap.
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
    requested.push({
      address,
      customerReference: input.customerReference,
      uploadQuotaBytes: input.uploadQuotaBytes ?? null,
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
  )
  if (enrolled.isErr()) return err(enrolled.error)

  logger.info('End users enrolled', {
    organizationId,
    count: requested.length,
    by: executor.publicId,
  })
  return ok(enrolled.value)
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
  removeEndUser,
  listEndUsers,
}
