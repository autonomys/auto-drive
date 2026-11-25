import { err, ok, Result } from 'neverthrow'
import { PartnerOrigin, User, UserRole } from '@auto-drive/models'
import {
  AuthManager,
  OrganizationRequestError,
} from '../../infrastructure/services/auth/index.js'
import { ForbiddenError } from '../../errors/index.js'
import { getPartnerAccount } from './organizations.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('core:partnerOrigins')

type PartnerOriginsError = ForbiddenError | OrganizationRequestError

/**
 * The origins of a partner's app are managed by Auto Drive admins only: an
 * origin decides where the partner's end users can sign in, and they can sign
 * in nowhere else.
 */
const authorize = async (
  executor: User,
  organizationId: string,
): Promise<Result<void, PartnerOriginsError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('User does not have admin privileges'))
  }
  const partnerAccount = await getPartnerAccount(organizationId)
  return partnerAccount.isErr() ? err(partnerAccount.error) : ok()
}

const listPartnerOrigins = async (
  executor: User,
  organizationId: string,
): Promise<Result<PartnerOrigin[], PartnerOriginsError>> => {
  const allowed = await authorize(executor, organizationId)
  if (allowed.isErr()) return err(allowed.error)

  return AuthManager.listPartnerOrigins(organizationId)
}

// Auth checks that it is an https origin no organisation has registered.
const addPartnerOrigin = async (
  executor: User,
  organizationId: string,
  origin: string,
): Promise<Result<PartnerOrigin, PartnerOriginsError>> => {
  const allowed = await authorize(executor, organizationId)
  if (allowed.isErr()) return err(allowed.error)

  const added = await AuthManager.addPartnerOrigin(
    organizationId,
    origin,
    executor.publicId,
  )
  if (added.isErr()) return err(added.error)

  logger.info('Partner origin added', {
    organizationId,
    origin: added.value.origin,
    by: executor.publicId,
  })
  return ok(added.value)
}

// Auth refuses while the organisation has end users, removed ones included.
const removePartnerOrigin = async (
  executor: User,
  organizationId: string,
  origin: string,
): Promise<Result<void, PartnerOriginsError>> => {
  const allowed = await authorize(executor, organizationId)
  if (allowed.isErr()) return err(allowed.error)

  const removed = await AuthManager.removePartnerOrigin(organizationId, origin)
  if (removed.isErr()) return err(removed.error)

  logger.info('Partner origin removed', {
    organizationId,
    origin,
    by: executor.publicId,
  })
  return ok()
}

export const PartnerOriginsUseCases = {
  listPartnerOrigins,
  addPartnerOrigin,
  removePartnerOrigin,
}
