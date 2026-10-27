import { describe, it, expect, jest, afterEach } from '@jest/globals'
import type { Request, Response } from 'express'
import { handleS3Auth } from '../../../src/app/controllers/s3/auth.js'
import {
  AuthLookupError,
  AuthManager,
} from '../../../src/infrastructure/services/auth/index.js'
import { createMockUser } from '../../utils/mocks.js'

// Every way an S3 request can fail to authenticate has to come back as an S3
// protocol response: an <Error> XML document with an S3 Code, at the status S3
// defines. The status matters as much as the body — 5xx is in every S3 client's
// and rclone's retryable set, so answering 500 for a bad API key makes them back
// off and retry a credential that can never work.

/** Minimal Response stand-in capturing the status and rendered body. */
const stubRes = () => {
  const state = { status: 200, body: '', headers: new Map<string, string>() }
  const res = {
    status: (code: number) => {
      state.status = code
      return res
    },
    setHeader: (name: string, value: string) => {
      state.headers.set(name.toLowerCase(), value)
      return res
    },
    send: (body: string) => {
      state.body = body
      return res
    },
  }
  return { res: res as unknown as Response, state }
}

const reqWith = (authorization?: string) =>
  ({ headers: authorization ? { authorization } : {} }) as unknown as Request

/** The S3 error Code out of an <Error> document. */
const codeOf = (body: string) => body.match(/<Code>([^<]*)<\/Code>/)?.[1]

const VALID_HEADER =
  'AWS4-HMAC-SHA256 Credential=e046e71c8dc3459c8da189e62418203a/20260821/us-west-2/s3/aws4_request, SignedHeaders=host, Signature=0'

describe('handleS3Auth', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('answers an unsigned request with 403 AccessDenied XML', async () => {
    const { res, state } = stubRes()

    expect(await handleS3Auth(reqWith(), res)).toBeNull()
    expect(state.status).toBe(403)
    expect(codeOf(state.body)).toBe('AccessDenied')
    // toContain, not toBe: Express's res.send appends '; charset=utf-8'.
    expect(state.headers.get('content-type')).toContain('application/xml')
  })

  it('answers an unparsable Authorization header with 400 AuthorizationHeaderMalformed', async () => {
    const { res, state } = stubRes()

    expect(await handleS3Auth(reqWith('Bearer not-sigv4'), res)).toBeNull()
    expect(state.status).toBe(400)
    expect(codeOf(state.body)).toBe('AuthorizationHeaderMalformed')
  })

  it('answers a rejected API key with 403 InvalidAccessKeyId, never a retryable 5xx', async () => {
    const { res, state } = stubRes()
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockRejectedValue(new AuthLookupError('rejected', true, 401) as never)

    expect(await handleS3Auth(reqWith(VALID_HEADER), res)).toBeNull()
    expect(state.status).toBe(403)
    expect(codeOf(state.body)).toBe('InvalidAccessKeyId')
  })

  it('answers an unavailable auth service with a retryable 503 ServiceUnavailable', async () => {
    const { res, state } = stubRes()
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockRejectedValue(new AuthLookupError('unreachable', false) as never)

    expect(await handleS3Auth(reqWith(VALID_HEADER), res)).toBeNull()
    // The one case where a retry IS the right client behaviour.
    expect(state.status).toBe(503)
    expect(codeOf(state.body)).toBe('ServiceUnavailable')
  })

  it('reports an unexpected lookup failure as a 5xx, not a bad key', async () => {
    const { res, state } = stubRes()
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockRejectedValue(new Error('boom') as never)

    // A fault in this service is not a verdict on the credential. Answering 403
    // would blame the caller, fire no alert, and send them rotating good keys.
    expect(await handleS3Auth(reqWith(VALID_HEADER), res)).toBeNull()
    expect(state.status).toBe(503)
    expect(codeOf(state.body)).toBe('ServiceUnavailable')
  })

  it('returns the user and writes nothing when the key is good', async () => {
    const { res, state } = stubRes()
    const user = createMockUser()
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(user as never)

    const req = reqWith(VALID_HEADER)
    expect(await handleS3Auth(req, res)).toEqual(user)
    expect(state.body).toBe('')
    // The tracing middleware attributes the request by this header.
    expect(req.headers['x-auth-provider']).toBe('apikey')
  })
})

describe('AuthManager.getUserFromAccessToken failure classification', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  const lookup = async () => {
    try {
      await AuthManager.getUserFromAccessToken('apikey', 'some-key')
      throw new Error('expected the lookup to fail')
    } catch (error) {
      return error as AuthLookupError
    }
  }

  it('classifies a 4xx from the auth service as a credential failure', async () => {
    global.fetch = (async () =>
      new globalThis.Response('nope', { status: 401 })) as typeof fetch

    const error = await lookup()
    expect(error).toBeInstanceOf(AuthLookupError)
    expect(error.isCredentialFailure).toBe(true)
    expect(error.upstreamStatus).toBe(401)
  })

  it('classifies a 5xx from the auth service as a service failure', async () => {
    global.fetch = (async () =>
      new globalThis.Response('boom', { status: 502 })) as typeof fetch

    const error = await lookup()
    // The credential was never judged, so it must not be reported as bad.
    expect(error.isCredentialFailure).toBe(false)
    expect(error.upstreamStatus).toBe(502)
  })

  it('classifies a transport failure as a service failure', async () => {
    global.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch

    const error = await lookup()
    expect(error).toBeInstanceOf(AuthLookupError)
    expect(error.isCredentialFailure).toBe(false)
    expect(error.upstreamStatus).toBeUndefined()
  })

  it('classifies a 404 as a service failure — a wrong URL, not a wrong key', async () => {
    global.fetch = (async () =>
      new globalThis.Response('not found', { status: 404 })) as typeof fetch

    // apps/auth never answers 404 for a credential; a proxy or a stale deploy
    // does, and every key would otherwise be reported permanently dead.
    const error = await lookup()
    expect(error.isCredentialFailure).toBe(false)
    expect(error.upstreamStatus).toBe(404)
  })

  it.each([408, 425, 429])(
    'classifies %i as a service failure, not a bad credential',
    async (status) => {
      global.fetch = (async () =>
        new globalThis.Response('slow down', { status })) as typeof fetch

      const error = await lookup()
      // The service declined to do the work; the key itself was never judged.
      // Reporting these as a rejection tells a client its working key is dead.
      expect(error.isCredentialFailure).toBe(false)
      expect(error.upstreamStatus).toBe(status)
    },
  )

  it('classifies an unreadable 200 body as a service failure', async () => {
    global.fetch = (async () =>
      new globalThis.Response('<html>gateway error</html>', {
        status: 200,
      })) as typeof fetch

    const error = await lookup()
    // A bare SyntaxError here would be read as a bad credential by every caller,
    // since they key off AuthLookupError.
    expect(error).toBeInstanceOf(AuthLookupError)
    expect(error.isCredentialFailure).toBe(false)
  })
})
