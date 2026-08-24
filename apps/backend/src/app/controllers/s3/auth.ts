import { Request, Response } from 'express'
import { UserWithOrganization } from '@auto-drive/models'
import {
  AuthLookupError,
  AuthManager,
} from '../../../infrastructure/services/auth/index.js'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import { sendXML } from './utils.js'

const logger = createLogger('s3:auth')

/**
 * Authenticate an S3 request from its SigV4 Authorization header.
 *
 * Lives in the controller layer, not alongside the other auth adapters, because
 * every failure it reports has to be an S3 protocol response: an <Error> XML
 * document with an S3 error Code, at the status S3 defines for that failure.
 * Anything else is unusable — an S3 SDK cannot parse a JSON body, and Express's
 * default HTML 500 is worse than unusable: 5xx is in every S3 client's and
 * rclone's retryable set, so a permanently-bad API key gets retried with
 * backoff instead of failing immediately.
 *
 * Auto Drive does not verify the SigV4 signature; the Credential's access-key
 * id IS the Auto Drive API key, and the auth service is the authority on it.
 * The status split that matters is therefore:
 *   - the key is rejected            → 403 InvalidAccessKeyId (permanent)
 *   - the auth service cannot answer → 503 ServiceUnavailable (retryable)
 *
 * Returns the authenticated user, or null once a response has been sent.
 */
export const handleS3Auth = async (
  req: Request,
  res: Response,
): Promise<UserWithOrganization | null> => {
  const authHeader = req.headers['authorization']
  if (!authHeader) {
    // An unsigned request for a private resource: S3 answers 403 AccessDenied.
    sendXML(res.status(403), 'Error', {
      Code: 'AccessDenied',
      Message: 'Access Denied',
    })
    return null
  }

  const apiKey = authHeader.match(/Credential=([A-Za-z0-9]*)\//)?.[1]
  if (!apiKey) {
    sendXML(res.status(400), 'Error', {
      Code: 'AuthorizationHeaderMalformed',
      Message:
        'The authorization header is malformed; it must carry a Credential of the form <access-key-id>/<scope>.',
    })
    return null
  }

  // Label the request for the tracing middleware, which reads this header to
  // attribute a request to an auth provider.
  req.headers['x-auth-provider'] = 'apikey'

  let user: UserWithOrganization
  try {
    user = await AuthManager.getUserFromAccessToken('apikey', apiKey)
  } catch (error) {
    if (error instanceof AuthLookupError && !error.isCredentialFailure) {
      // The auth service is unavailable — the one case where a retry is the
      // right client behaviour, so say so with a retryable S3 code.
      logger.error('Auth service unavailable during S3 auth', error)
      sendXML(res.status(503), 'Error', {
        Code: 'ServiceUnavailable',
        Message:
          'The authentication service is temporarily unavailable. Please retry.',
      })
      return null
    }
    logger.info('Rejected S3 request with an invalid API key')
    sendXML(res.status(403), 'Error', {
      Code: 'InvalidAccessKeyId',
      Message: 'The Access Key Id you provided does not exist in our records.',
    })
    return null
  }

  if (!user) {
    sendXML(res.status(403), 'Error', {
      Code: 'InvalidAccessKeyId',
      Message: 'The Access Key Id you provided does not exist in our records.',
    })
    return null
  }

  return user
}
