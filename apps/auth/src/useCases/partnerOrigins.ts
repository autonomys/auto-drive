import { PartnerOrigin } from '@auto-drive/models'
import {
  DBPartnerOrigin,
  organizationMembersRepository,
  organizationsRepository,
  partnerOriginsRepository,
} from '../repositories/index.js'
import { withTransaction } from '../drivers/pg.js'
import { config } from '../config.js'
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
  OrganizationValidationError,
} from '../errors/organizations.js'

const toPartnerOrigin = (row: DBPartnerOrigin): PartnerOrigin => ({
  origin: row.origin,
  organizationId: row.organization_id,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
})

/**
 * An origin as wallet sign-in compares it: lower case, with no path or
 * trailing slash. Throws unless it is an https origin.
 */
export const parsePartnerOrigin = (value: string): string => {
  const normalized = value.trim().replace(/\/+$/, '').toLowerCase()
  if (
    !normalized.startsWith('https://') ||
    !URL.canParse(normalized) ||
    new URL(normalized).origin !== normalized
  ) {
    throw new OrganizationValidationError(
      `Not an https origin: ${value}. Expected https://host[:port]`,
    )
  }
  return normalized
}

const isUniqueViolation = (error: unknown) =>
  (error as { code?: string } | null)?.code === '23505'

const listOrigins = async (
  organizationId: string,
): Promise<PartnerOrigin[]> => {
  const organization =
    await organizationsRepository.getOrganizationById(organizationId)
  if (!organization) {
    throw new OrganizationNotFoundError('Organization not found')
  }
  const rows =
    await partnerOriginsRepository.getOriginsByOrganization(organizationId)
  return rows.map(toPartnerOrigin)
}

/**
 * Registers an origin of a partner's app. Each origin belongs to one
 * organisation, so registering one that is already registered is a conflict.
 */
const addOrigin = async ({
  organizationId,
  origin,
  actor,
}: {
  organizationId: string
  origin: string
  actor: string
}): Promise<PartnerOrigin> => {
  const normalized = parsePartnerOrigin(origin)
  // A partner origin takes precedence in sign-in, so one of the global
  // allowlist would lock its wallet users out.
  if (config.web3Auth.allowedOrigins.includes(normalized)) {
    throw new OrganizationConflictError(
      `${normalized} is in WEB3_AUTH_ALLOWED_ORIGINS`,
    )
  }
  try {
    return await withTransaction(async (db) => {
      const organization =
        await organizationsRepository.getOrganizationForUpdate(
          organizationId,
          db,
        )
      if (!organization) {
        throw new OrganizationNotFoundError('Organization not found')
      }
      if (organization.archived_at) {
        throw new OrganizationConflictError('Organization is archived')
      }
      if (await partnerOriginsRepository.getOriginForUpdate(normalized, db)) {
        throw new OrganizationConflictError(
          `${normalized} is already registered`,
        )
      }
      return toPartnerOrigin(
        await partnerOriginsRepository.addOrigin(
          { origin: normalized, organizationId, createdBy: actor },
          db,
        ),
      )
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new OrganizationConflictError(`${normalized} is already registered`)
    }
    throw error
  }
}

/**
 * Unregisters an origin. An organisation's end users, removed ones included,
 * sign in only through its origins, so one is never removed while the
 * organisation has any.
 */
const removeOrigin = async ({
  organizationId,
  origin,
}: {
  organizationId: string
  origin: string
}): Promise<void> => {
  const normalized = parsePartnerOrigin(origin)
  await withTransaction(async (db) => {
    // Read FOR UPDATE like enrolment, so no end user is enrolled while it is
    // removed.
    const organization = await organizationsRepository.getOrganizationForUpdate(
      organizationId,
      db,
    )
    if (!organization) {
      throw new OrganizationNotFoundError('Organization not found')
    }
    const row = await partnerOriginsRepository.getOriginForUpdate(
      normalized,
      db,
    )
    if (row?.organization_id !== organizationId) {
      throw new OrganizationNotFoundError(
        `${normalized} is not an origin of this organization`,
      )
    }
    if (await organizationMembersRepository.hasEndUsers(organizationId, db)) {
      throw new OrganizationConflictError(
        'The organization has end users, who sign in only through its ' +
          'origins, so none can be removed',
      )
    }
    await partnerOriginsRepository.removeOrigin(normalized, db)
  })
}

export const PartnerOriginsUseCases = {
  listOrigins,
  addOrigin,
  removeOrigin,
}
