import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { AuthManager } from '../../src/infrastructure/services/auth/index.js'
import { ServiceUnavailableError } from '../../src/errors/index.js'
import { config } from '../../src/config.js'

describe('Auth service organization requests', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  const answer = (status: number, body?: unknown) => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
    )
    global.fetch = fetchMock
    return fetchMock
  }

  it('sends the origin to remove as a query parameter', async () => {
    const fetchMock = answer(204)

    const result = await AuthManager.removePartnerOrigin(
      'org-1',
      'https://app.partner.example',
    )

    expect(result.isOk()).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `${config.authService.url}/organizations/org-1/partner-origins?origin=https%3A%2F%2Fapp.partner.example`,
    )
    expect(init?.method).toBe('DELETE')
  })

  it('passes on a change that kept conflicting as a 503 to send again', async () => {
    const error = 'Too many concurrent changes, try again'
    answer(503, { error })

    const result = await AuthManager.removePartnerOrigin(
      'org-1',
      'https://app.partner.example',
    )

    expect(result._unsafeUnwrapErr()).toEqual(
      new ServiceUnavailableError(error),
    )
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ServiceUnavailableError)
  })
})
