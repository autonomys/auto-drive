import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { OrganizationRole, UserRole } from '@auto-drive/models'
import { AuthManager } from '../../src/infrastructure/services/auth/index.js'

const user = (publicId: string, onboarded = true) => ({
  oauthProvider: 'google',
  oauthUserId: `oauth-${publicId}`,
  role: UserRole.User,
  publicId: onboarded ? publicId : null,
  onboarded,
  organizationId: onboarded ? 'org-1' : null,
})

// Answers /users/@me with the user for each token, and the organization
// routes with 204.
const mockAuthService = (users: Record<string, ReturnType<typeof user>>) => {
  const fetchMock = jest.fn<typeof fetch>(async (_url, init) => {
    const headers = init?.headers as Record<string, string>
    const token = headers.Authorization.replace('Bearer ', '')
    if (users[token]) return new Response(JSON.stringify(users[token]))
    return new Response(null, { status: 204 })
  })
  global.fetch = fetchMock
  return fetchMock
}

const lookUps = (fetchMock: jest.Mock<typeof fetch>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/users/@me'))
    .length

// The cache outlives each test, so every test uses its own tokens.
describe('Session lookups', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('asks the auth service once per session within 60 seconds', async () => {
    const fetchMock = mockAuthService({ 'token-a': user('user-a') })

    await AuthManager.getUserFromAccessToken('custom-jwt', 'token-a')
    const again = await AuthManager.getUserFromAccessToken(
      'custom-jwt',
      'token-a',
    )

    expect(again.publicId).toBe('user-a')
    expect(lookUps(fetchMock)).toBe(1)
  })

  it('keeps the provider in the key', async () => {
    const fetchMock = mockAuthService({ 'token-c': user('user-c') })

    await AuthManager.getUserFromAccessToken('custom-jwt', 'token-c')
    await AuthManager.getUserFromAccessToken('web3-wallet', 'token-c')

    expect(lookUps(fetchMock)).toBe(2)
  })

  it('asks every time for an API key', async () => {
    const fetchMock = mockAuthService({ 'key-d': user('user-d') })

    await AuthManager.getUserFromAccessToken('apikey', 'key-d')
    await AuthManager.getUserFromAccessToken('apikey', 'key-d')

    expect(lookUps(fetchMock)).toBe(2)
  })

  it('asks every time for a user yet to accept the Terms', async () => {
    const fetchMock = mockAuthService({ 'token-e': user('user-e', false) })

    await AuthManager.getUserFromAccessToken('custom-jwt', 'token-e')
    await AuthManager.getUserFromAccessToken('custom-jwt', 'token-e')

    expect(lookUps(fetchMock)).toBe(2)
  })

  it('does not keep a failed lookup', async () => {
    global.fetch = jest.fn<typeof fetch>(
      async () => new Response('down', { status: 503 }),
    )
    await expect(
      AuthManager.getUserFromAccessToken('custom-jwt', 'token-f'),
    ).rejects.toThrow()

    const fetchMock = mockAuthService({ 'token-f': user('user-f') })
    const found = await AuthManager.getUserFromAccessToken(
      'custom-jwt',
      'token-f',
    )

    expect(found.publicId).toBe('user-f')
    expect(lookUps(fetchMock)).toBe(1)
  })

  it.each([
    [
      'added to',
      () =>
        AuthManager.addOrganizationMember(
          'org-2',
          { publicId: 'user-g', role: OrganizationRole.Member },
          'admin',
        ),
    ],
    [
      'given a new role in',
      () =>
        AuthManager.changeOrganizationMemberRole(
          'org-1',
          'user-g',
          OrganizationRole.Admin,
          'admin',
        ),
    ],
    [
      'removed from',
      () => AuthManager.removeOrganizationMember('org-1', 'user-g', 'admin'),
    ],
  ])(
    'asks again once a user is %s an organisation',
    async (change, changeMembership) => {
      const tokens = ['g1', 'g2', 'h'].map((t) => `${change} ${t}`)
      const fetchMock = mockAuthService({
        [tokens[0]]: user('user-g'),
        [tokens[1]]: user('user-g'),
        [tokens[2]]: user('user-h'),
      })
      for (const token of tokens) {
        await AuthManager.getUserFromAccessToken('custom-jwt', token)
      }

      await changeMembership()
      for (const token of tokens) {
        await AuthManager.getUserFromAccessToken('custom-jwt', token)
      }

      // Both of user-g's sessions, and not user-h's.
      expect(lookUps(fetchMock)).toBe(3 + 2)
    },
  )
})
