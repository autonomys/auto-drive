import {
  describe,
  it,
  expect,
  jest,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from '@jest/globals'
import express from 'express'
import { AddressInfo } from 'net'
import { Server } from 'http'
import { err, ok } from 'neverthrow'
import { v4 } from 'uuid'
import {
  Account,
  AccountModel,
  PartnerOrigin,
  SERVICE_USER_PROVIDER,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { organizationsController } from '../../../src/app/controllers/organizations.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { ConflictError } from '../../../src/errors/index.js'
import { createMockUser } from '../../utils/mocks.js'

const ORIGIN = 'https://app.partner.example'

// The auth service owns partner origins and is mocked: these tests cover who
// may call the routes and what they pass to auth.
describe('Partner origins', () => {
  let server: Server
  let baseUrl: string
  let organizationId: string
  let caller: UserWithOrganization
  let listInAuth: jest.SpiedFunction<typeof AuthManager.listPartnerOrigins>
  let addInAuth: jest.SpiedFunction<typeof AuthManager.addPartnerOrigin>
  let removeInAuth: jest.SpiedFunction<typeof AuthManager.removePartnerOrigin>

  beforeAll(async () => {
    const app = express()
    app.use(express.json())
    app.use('/organizations', organizationsController)
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  const autoDriveAdmin = () => ({
    ...createMockUser(),
    publicId: 'auto-drive-admin',
    role: UserRole.Admin,
  })
  const orgAdmin = () => ({ ...createMockUser(), organizationId })
  const orgKey = (): UserWithOrganization => ({
    ...createMockUser(),
    oauthProvider: SERVICE_USER_PROVIDER,
    oauthUserId: organizationId,
    organizationId,
    apiKeyId: 'org-key',
    apiKeyScopes: null,
  })

  const partnerOrigin = (origin: string): PartnerOrigin => ({
    origin,
    organizationId,
    createdBy: 'auto-drive-admin',
    createdAt: '2026-11-25T00:00:00.000Z',
  })

  beforeEach(() => {
    organizationId = `partner-${v4()}`
    caller = autoDriveAdmin()
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockImplementation(async () => caller)
    jest.spyOn(accountsRepository, 'getByOrganizationId').mockImplementation(
      async (id) =>
        ({
          id: `account-${id}`,
          organizationId: id,
          model: AccountModel.Monthly,
          isPartner: id.startsWith('partner'),
        }) as Account,
    )
    listInAuth = jest
      .spyOn(AuthManager, 'listPartnerOrigins')
      .mockResolvedValue(ok([partnerOrigin(ORIGIN)]))
    addInAuth = jest
      .spyOn(AuthManager, 'addPartnerOrigin')
      .mockImplementation(async (_id, origin) => ok(partnerOrigin(origin)))
    removeInAuth = jest
      .spyOn(AuthManager, 'removePartnerOrigin')
      .mockResolvedValue(ok(undefined))
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const headers = {
    authorization: 'Bearer token',
    'x-auth-provider': 'custom-jwt',
    'content-type': 'application/json',
  }
  const url = (path = '', organization = organizationId) =>
    `${baseUrl}/organizations/${organization}/partner-origins${path}`
  const list = (organization?: string) =>
    fetch(url('', organization), { headers })
  const add = (body: unknown, organization?: string) =>
    fetch(url('', organization), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  const remove = (origin: string, organization?: string) =>
    fetch(url(`?${new URLSearchParams({ origin })}`, organization), {
      method: 'DELETE',
      headers,
    })

  it.each([
    ['an Auto Drive admin', autoDriveAdmin, [200, 201, 204]],
    ['an organization admin', orgAdmin, [403, 403, 403]],
    ['the organization key', orgKey, [403, 403, 403]],
  ])('answers list, add and remove from %s', async (_, as, statuses) => {
    caller = as()

    const responses = [
      await list(),
      await add({ origin: ORIGIN }),
      await remove(ORIGIN),
    ]

    expect(responses.map((r) => r.status)).toEqual(statuses)
    const calls = [listInAuth, addInAuth, removeInAuth].map(
      (mock) => mock.mock.calls.length,
    )
    expect(calls).toEqual(statuses.map((status) => (status === 403 ? 0 : 1)))
  })

  it('passes the origin and the admin to auth', async () => {
    const added = await add({ origin: ORIGIN })
    expect(added.status).toBe(201)
    expect(await added.json()).toEqual(partnerOrigin(ORIGIN))
    expect(addInAuth).toHaveBeenCalledWith(
      organizationId,
      ORIGIN,
      'auto-drive-admin',
    )

    expect((await remove(ORIGIN)).status).toBe(204)
    expect(removeInAuth).toHaveBeenCalledWith(organizationId, ORIGIN)
    // As nginx passes it on when the client did not encode it.
    const unencoded = await fetch(url(`?origin=${ORIGIN}`), {
      method: 'DELETE',
      headers,
    })
    expect(unencoded.status).toBe(204)
    expect(removeInAuth).toHaveBeenLastCalledWith(organizationId, ORIGIN)
    const missing = await fetch(url(), { method: 'DELETE', headers })
    expect(missing.status).toBe(400)
    expect(removeInAuth).toHaveBeenCalledTimes(2)

    expect((await add({})).status).toBe(400)
    expect((await add({ origin: 1 })).status).toBe(400)
    expect(addInAuth).toHaveBeenCalledTimes(1)
  })

  it('answers 404 for an organization that is not a partner', async () => {
    const personal = `personal-${v4()}`

    const responses = [
      await list(personal),
      await add({ origin: ORIGIN }, personal),
      await remove(ORIGIN, personal),
    ]

    expect(responses.map((r) => r.status)).toEqual([404, 404, 404])
    expect(listInAuth).not.toHaveBeenCalled()
    expect(addInAuth).not.toHaveBeenCalled()
    expect(removeInAuth).not.toHaveBeenCalled()
  })

  it('passes on what auth refuses', async () => {
    const message =
      'The organization has end users, who sign in only through its origins, so none can be removed'
    removeInAuth.mockResolvedValueOnce(err(new ConflictError(message)))

    const refused = await remove(ORIGIN)

    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: message })
  })
})
