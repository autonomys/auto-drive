import { err, ok, Result } from 'neverthrow'
import { UserWithOrganization, isPartnerEndUser } from '@auto-drive/models'
import { BadRequestError, ForbiddenError } from '../../errors/index.js'

// A caller's own reference for the customer an upload was made for (#892), for
// example a partner's pseudonymous customer ID. Auto Drive does not interpret
// it: it is stored with the upload's interactions and shown only in its
// account's usage reports.
export const CUSTOMER_REFERENCE = /^[A-Za-z0-9._:-]{1,128}$/

const INVALID_CUSTOMER_REFERENCE =
  'Invalid customer reference: use 1 to 128 letters, digits, "-", "_", "." or ":"'

/**
 * The reference sent in a request header, or null if there is none. Node joins
 * a repeated header with ", ", which the format rejects.
 */
export const parseCustomerReference = (
  header: string | string[] | undefined,
): Result<string | null, BadRequestError> => {
  if (header === undefined) return ok(null)
  return typeof header === 'string' && CUSTOMER_REFERENCE.test(header)
    ? ok(header)
    : err(new BadRequestError(INVALID_CUSTOMER_REFERENCE))
}

/**
 * The customer reference to record an upload or interaction under. A partner
 * end user's is always the one they were enrolled with, whatever the request
 * sent, so their usage is reported per person and counted against their
 * quota. Anyone else's is the one they sent.
 */
export const stampCustomerReference = (
  user: UserWithOrganization,
  requested: string | null,
): string | null => {
  if (!isPartnerEndUser(user)) return requested
  // Only an auth service older than partner end users could leave it out.
  if (!user.customerReference) {
    throw new ForbiddenError('Partner end user has no customer reference')
  }
  return user.customerReference
}
