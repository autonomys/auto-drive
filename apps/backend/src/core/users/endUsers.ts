import { err, ok, Result } from 'neverthrow'
import { getAddress, isAddress } from 'viem'
import {
  EndUser,
  OrganizationRole,
  SERVICE_USER_PROVIDER,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { endUsersRepository } from '../../infrastructure/repositories/users/endUsers.js'
import {
  AuthManager,
  OrganizationRequestError,
} from '../../infrastructure/services/auth/index.js'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../errors/index.js'
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
 * Enrols end users: the auth service creates their identities, then they are
 * recorded here with what the partner gave for them. An address already
 * enrolled with the same customer reference is returned as it is. Auth
 * returns the identities it has already created, so a request that fails
 * after auth succeeded is completed by retrying it.
 */
const enrollEndUsers = async (
  executor: UserWithOrganization,
  organizationId: string,
  inputs: EndUserInput[],
): Promise<Result<EndUser[], EndUsersError>> => {
  const allowed = await authorize(executor, organizationId, 'enroll')
  if (allowed.isErr()) return err(allowed.error)

  const requested: EndUserInput[] = []
  for (const input of inputs) {
    const address = normaliseAddress(input.address)
    if (!address) {
      return err(new BadRequestError(`Invalid address: ${input.address}`))
    }
    requested.push({ ...input, address })
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

  const existing = await endUsersRepository.getActiveByAddressesOrReferences(
    organizationId,
    addresses,
    references,
  )
  for (const endUser of existing) {
    const input = requested.find((r) => r.address === endUser.address)
    if (!input) {
      return err(
        new ConflictError(
          `Customer reference ${endUser.customerReference} is already used by another end user`,
        ),
      )
    }
    if (input.customerReference !== endUser.customerReference) {
      return err(
        new ConflictError(
          `${endUser.address} is already enrolled with another customer reference`,
        ),
      )
    }
  }

  const enrolled = new Map(existing.map((e) => [e.address, e]))
  const toEnroll = requested.filter((r) => !enrolled.has(r.address))
  if (toEnroll.length > 0) {
    const active = await endUsersRepository.countActive(organizationId)
    const max = config.params.partnerMaxEndUsers
    if (active + toEnroll.length > max) {
      return err(
        new ConflictError(
          `An organization can have at most ${max} end users: it has ` +
            `${active}, and this would add ${toEnroll.length}`,
        ),
      )
    }

    const identities = await AuthManager.enrollOrganizationEndUsers(
      organizationId,
      toEnroll.map((r) => r.address),
      executor.publicId,
    )
    if (identities.isErr()) return err(identities.error)
    const publicIds = new Map(
      identities.value.map((i) => [i.address, i.publicId]),
    )

    let inserted: EndUser[]
    try {
      inserted = await endUsersRepository.insertEndUsers(
        organizationId,
        toEnroll.map((r) => ({
          address: r.address,
          publicId: publicIds.get(r.address)!,
          customerReference: r.customerReference,
          uploadQuotaBytes: r.uploadQuotaBytes ?? null,
        })),
      )
    } catch (error) {
      // A unique index: a concurrent request enrolled one of them first.
      if ((error as { code?: string }).code === '23505') {
        return err(
          new ConflictError(
            'An address or customer reference was enrolled by a concurrent request',
          ),
        )
      }
      throw error
    }
    for (const endUser of inserted) {
      enrolled.set(endUser.address, endUser)
    }
  }

  logger.info('End users enrolled', {
    organizationId,
    enrolled: toEnroll.length,
    alreadyEnrolled: requested.length - toEnroll.length,
    by: executor.publicId,
  })
  return ok(requested.map((r) => enrolled.get(r.address)!))
}

/**
 * Removes an end user. The auth service gives them a personal organisation of
 * their own, and their files stay theirs. Auth is called first, so a failure
 * leaves the end user listed and a retry completes the removal.
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
  const [endUser] = await endUsersRepository.getActiveByAddressesOrReferences(
    organizationId,
    [normalised],
    [],
  )
  if (!endUser) {
    return err(new NotFoundError('Not an end user of this organization'))
  }

  const removed = await AuthManager.removeOrganizationEndUser(
    organizationId,
    endUser.publicId,
    executor.publicId,
  )
  // 404: an earlier attempt removed them from auth.
  if (removed.isErr() && !(removed.error instanceof NotFoundError)) {
    return err(removed.error)
  }
  await endUsersRepository.markRemoved(organizationId, normalised)

  logger.info('End user removed', {
    organizationId,
    publicId: endUser.publicId,
    by: executor.publicId,
  })
  return ok()
}

const listEndUsers = async (
  executor: UserWithOrganization,
  organizationId: string,
  { limit, offset }: { limit: number; offset: number },
): Promise<
  Result<{ endUsers: EndUser[]; totalCount: number }, EndUsersError>
> => {
  const allowed = await authorize(executor, organizationId, 'list')
  if (allowed.isErr()) return err(allowed.error)

  const [endUsers, totalCount] = await Promise.all([
    endUsersRepository.listActive(organizationId, limit, offset),
    endUsersRepository.countActive(organizationId),
  ])
  return ok({ endUsers, totalCount })
}

export const EndUsersUseCases = {
  enrollEndUsers,
  removeEndUser,
  listEndUsers,
}
