import { jest } from '@jest/globals'
import express, { Router } from 'express'
import { Server } from 'http'
import { AddressInfo } from 'net'
import { Wallet } from 'ethers'
import jwt from 'jsonwebtoken'
import {
  CustomAccessTokenPayload,
  MaybeUser,
  OrganizationRole,
  User,
  UserRole,
} from '@auto-drive/models'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { OrganizationsUseCases, UsersUseCases } from '../src/useCases/index.js'
import { jwtTokenRegistry, usersRepository } from '../src/repositories/index.js'
import { AuthManager } from '../src/services/authManager/index.js'
import { CustomJWTAuth } from '../src/services/authManager/providers/custom.js'
import { userController } from '../src/controllers/user.js'
import { organizationController } from '../src/controllers/organization.js'
import { dbMigration } from './utils/dbMigrate.js'
import { createUnonboardedUser } from './utils/mocks.js'

const WALLET = 'web3-wallet'
const EXCHANGE = 'POST /users/@me/accessToken'

type Layer = {
  route?: { path: string; methods: Record<string, boolean> }
}

// Each route of a router as 'METHOD /path'.
const routesOf = (prefix: string, router: Router) => [
  ...new Set(
    (router.stack as Layer[]).flatMap(({ route }) =>
      route
        ? Object.keys(route.methods)
            // .all() only declares who may use a route.
            .filter((method) => method !== '_all')
            .map((method) => `${method.toUpperCase()} ${prefix}${route.path}`)
        : [],
    ),
  ),
]

// The routes partner end users may use. Opening another one to them means
// adding it here.
const OPEN = [
  'GET /users/@me',
  'POST /users/@me/accessToken',
  'POST /users/@me/deletion',
  'DELETE /users/@me/deletion',
  'GET /users/@me/deletion',
]
// Routes that take no user credential.
const PUBLIC = [
  'POST /users/web3/nonce',
  'POST /users/@me/refreshToken',
  'DELETE /users/@me/invalidateToken',
]
// Routes only the backend may use, with its service secret.
const SERVICE = [
  'POST /users/apiKeys/batch',
  'POST /organizations/',
  'POST /organizations/batch',
  'GET /organizations/:organizationId/membership-changes',
  'POST /organizations/:organizationId/members',
  'PUT /organizations/:organizationId/members/:publicId',
  'DELETE /organizations/:organizationId/members/:publicId',
  'POST /organizations/:organizationId/end-users',
  'GET /organizations/:organizationId/end-users',
  'DELETE /organizations/:organizationId/end-users/:address',
  'PATCH /organizations/:organizationId/end-users/:address',
  'GET /organizations/:organizationId/partner-origins',
  'POST /organizations/:organizationId/partner-origins',
  'DELETE /organizations/:organizationId/partner-origins',
  'GET /organizations/:organizationId/apiKeys',
  'POST /organizations/:organizationId/apiKeys',
  'DELETE /organizations/:organizationId/apiKeys/:apiKeyId',
]

describe('Partner end user access', () => {
  let server: Server
  let baseUrl: string
  let partnerId: string
  let endUser: User
  let signedIn: MaybeUser

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
    const app = express()
    app.use(express.json())
    app.use('/users', userController)
    app.use('/organizations', organizationController)
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await closeDatabase()
    await dbMigration.down()
  })

  beforeEach(async () => {
    partnerId = (await OrganizationsUseCases.createOrganization('Partner')).id
    const address = Wallet.createRandom().address
    await OrganizationsUseCases.enrollEndUsers({
      organizationId: partnerId,
      endUsers: [
        { address, customerReference: 'customer-1', uploadQuotaBytes: 1024 },
      ],
      maxEndUsers: 100,
      actor: 'test',
    })
    endUser = (await UsersUseCases.getUserByOAuthUser({
      provider: WALLET,
      id: address,
    })) as User
    signedIn = endUser
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockImplementation(async () => ({
        provider: signedIn.oauthProvider,
        id: signedIn.oauthUserId,
      }))
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const removeEndUser = () =>
    OrganizationsUseCases.removeEndUser({
      organizationId: partnerId,
      address: endUser.oauthUserId,
      actor: 'test',
    })

  // A session token, except for the exchange, which takes a wallet signature
  // from an end user.
  const providerFor = (route: string) =>
    route === EXCHANGE ? WALLET : 'custom-jwt'

  const send = (route: string, provider = providerFor(route)) => {
    const [method, path] = route.split(' ')
    return fetch(`${baseUrl}${path.replace(/:\w+/g, 'x')}`, {
      method,
      headers: {
        authorization: 'Bearer token',
        'x-auth-provider': provider,
        'content-type': 'application/json',
      },
      body: method === 'GET' ? undefined : '{}',
    })
  }

  const hasuraClaims = async (user: MaybeUser) => {
    const { accessToken } = await CustomJWTAuth.createSessionTokens(user)
    const payload = jwt.decode(accessToken) as CustomAccessTokenPayload
    return payload['https://hasura.io/jwt/claims']
  }

  it('names only routes that exist', () => {
    const routes = [
      ...routesOf('/users', userController),
      ...routesOf('/organizations', organizationController),
    ]
    expect(routes).toEqual(
      expect.arrayContaining([...OPEN, ...PUBLIC, ...SERVICE]),
    )
  })

  it.each([
    ['an end user', false],
    ['a removed end user', true],
  ])(
    'refuses %s on every user route but their own user, session tokens and account closure',
    async (_, removed) => {
      if (removed) await removeEndUser()
      const routes = [
        ...routesOf('/users', userController),
        ...routesOf('/organizations', organizationController),
      ].filter((route) => !PUBLIC.includes(route))

      // How each route answered the end user's session: 'open' only for a
      // success.
      const results: [string, string][] = []
      for (const route of routes) {
        const response = await send(route)
        const error = (await response.json().catch(() => null))?.error
        results.push([
          route,
          response.ok
            ? 'open'
            : response.status === 403 &&
                error === 'Not available to partner end users'
              ? 'refused'
              : response.status === 401 && error === 'Unauthorized'
                ? 'service only'
                : `${response.status} ${error}`,
        ])
      }

      expect(results).toEqual(
        routes.map((route) => [
          route,
          OPEN.includes(route)
            ? 'open'
            : SERVICE.includes(route)
              ? 'service only'
              : 'refused',
        ]),
      )
    },
  )

  it('leaves members as they were', async () => {
    const member = await UsersUseCases.onboardUser(createUnonboardedUser())
    signedIn = member!

    const apiKeys = await send('GET /users/@me/apiKeys')

    expect(apiKeys.status).toBe(200)
  })

  it('refuses to make them Auto Drive admins', async () => {
    const admin = await UsersUseCases.onboardUser(createUnonboardedUser())
    await usersRepository.updateRole(
      admin!.oauthProvider,
      admin!.oauthUserId,
      UserRole.Admin,
    )
    signedIn = admin!
    const makeAdmin = () =>
      fetch(`${baseUrl}/users/admin/add`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'x-auth-provider': 'custom-jwt',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ publicId: endUser.publicId }),
      })

    for (const removed of [false, true]) {
      if (removed) await removeEndUser()
      const response = await makeAdmin()
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({
        error: 'A partner end user cannot be made an admin',
      })
    }
    expect(
      (
        await usersRepository.getUserByOAuthInformation(
          WALLET,
          endUser.oauthUserId,
        )
      )?.role,
    ).toBe(UserRole.User)
  })

  it('returns their role and what the partner enrolled them with', async () => {
    const me = await send('GET /users/@me')
    expect(await me.json()).toMatchObject({
      publicId: endUser.publicId,
      organizationId: partnerId,
      organizationRole: OrganizationRole.PartnerEndUser,
      customerReference: 'customer-1',
      uploadQuotaBytes: 1024,
      endUserRemovedAt: null,
    })

    await removeEndUser()
    const removed = await (await send('GET /users/@me')).json()
    expect(removed).toMatchObject({
      organizationRole: OrganizationRole.PartnerEndUser,
      customerReference: 'customer-1',
      endUserRemovedAt: expect.any(String),
    })
  })

  it('returns the role of a member, and no end user fields', async () => {
    const member = await UsersUseCases.onboardUser(createUnonboardedUser())

    expect(await UsersUseCases.getUserWithOrganization(member!)).toMatchObject({
      organizationRole: OrganizationRole.Admin,
      customerReference: null,
      uploadQuotaBytes: null,
      endUserRemovedAt: null,
    })
  })

  it('gives their sessions only the partner_end_user Hasura role', async () => {
    const claims = await hasuraClaims(endUser)
    expect(claims).toMatchObject({
      'x-hasura-default-role': 'partner_end_user',
      'x-hasura-allowed-roles': ['partner_end_user'],
    })

    // Not even an Auto Drive admin role given before that was refused.
    await usersRepository.updateRole(
      WALLET,
      endUser.oauthUserId,
      UserRole.Admin,
    )
    await removeEndUser()
    expect(await hasuraClaims(endUser)).toMatchObject({
      'x-hasura-default-role': 'partner_end_user',
      'x-hasura-allowed-roles': ['partner_end_user'],
    })
  })

  it('gives them, removed or not, a 1-hour access token and no refresh token', async () => {
    const register = jest.spyOn(jwtTokenRegistry, 'addTokenToRegistry')

    for (const removed of [false, true]) {
      if (removed) await removeEndUser()
      const response = await send(EXCHANGE)

      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toBeNull()
      const { accessToken } = await response.json()
      const payload = jwt.decode(accessToken) as CustomAccessTokenPayload &
        jwt.JwtPayload
      expect(payload.refreshTokenId).toBeNull()
      expect(payload.exp! - payload.iat!).toBe(60 * 60)
      await expect(
        CustomJWTAuth.getUserFromAccessToken(accessToken),
      ).resolves.toMatchObject({ id: endUser.oauthUserId })
    }
    expect(register).not.toHaveBeenCalled()
  })

  it('refuses, removed or not, to exchange their session token for another', async () => {
    for (const removed of [false, true]) {
      if (removed) await removeEndUser()
      const response = await send(EXCHANGE, 'custom-jwt')

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'Partner end users sign in with a wallet signature',
      })
    }
  })

  it('refuses to refresh a session of theirs from before', async () => {
    // Issued before end users stopped getting refresh tokens.
    jest
      .spyOn(OrganizationsUseCases, 'isPartnerEndUser')
      .mockResolvedValueOnce(false)
    const { refreshToken } = await CustomJWTAuth.createSessionTokens(endUser)
    expect(refreshToken).toEqual(expect.any(String))

    for (const removed of [false, true]) {
      if (removed) await removeEndUser()
      const response = await fetch(`${baseUrl}/users/@me/refreshToken`, {
        method: 'POST',
        headers: { cookie: `refreshToken=${refreshToken}` },
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'Not available to partner end users',
      })
    }
  })

  it('still refreshes the session of a member', async () => {
    const member = await UsersUseCases.onboardUser(createUnonboardedUser())
    signedIn = member!

    const signIn = await send(EXCHANGE, 'custom-jwt')
    const cookie = signIn.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toMatch(/^refreshToken=/)
    const response = await fetch(`${baseUrl}/users/@me/refreshToken`, {
      method: 'POST',
      headers: { cookie: cookie! },
    })

    expect(response.status).toBe(200)
    const { accessToken } = await response.json()
    await expect(
      CustomJWTAuth.getUserFromAccessToken(accessToken),
    ).resolves.toMatchObject({ id: member!.oauthUserId })
    // A refresh token is not an access token.
    await expect(
      CustomJWTAuth.getUserFromAccessToken(cookie!.split('=')[1]),
    ).rejects.toThrow('Invalid access token')
  })

  it('keeps the Hasura roles of everyone else', async () => {
    const member = await UsersUseCases.onboardUser(createUnonboardedUser())
    expect(await hasuraClaims(member!)).toMatchObject({
      'x-hasura-default-role': 'user',
      'x-hasura-allowed-roles': ['user'],
    })

    await usersRepository.updateRole(
      member!.oauthProvider,
      member!.oauthUserId,
      UserRole.Admin,
    )
    expect(await hasuraClaims(member!)).toMatchObject({
      'x-hasura-default-role': 'app-admin',
      'x-hasura-allowed-roles': ['app-admin', 'user'],
    })
  })
})
