import { err, ok, Result } from 'neverthrow'
import { BadRequestError } from '../../errors/index.js'

// A caller's own reference for the customer an upload was made for (#892), for
// example a partner's pseudonymous customer ID. Auto Drive does not interpret
// it: it is stored with the upload's interactions and shown only in its
// account's usage reports.
const CUSTOMER_REFERENCE = /^[A-Za-z0-9._:-]{1,128}$/

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
