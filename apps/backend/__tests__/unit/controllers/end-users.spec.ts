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
import { getAddress } from 'viem'
import {
  Account,
  AccountModel,
  ApiKeyScope,
  OrganizationRole,
  OrganizationWithMembers,
  PartnerEndUser,
  SERVICE_USER_PROVIDER,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { organizationsController } from '../../../src/app/controllers/organizations.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { ConflictError, NotFoundError } from '../../../src/errors/index.js'
import { config } from '../../../src/config.js'
import { createMockUser } from '../../utils/mocks.js'

// A lower-case address, as a client may send it, and its EIP-55 form.
const newAddress = () => {
  const address = `0x${v4().replace(/-/g, '')}${v4().slice(0, 8)}`
  return { input: address, address: getAddress(address) }
}

const CREATED_AT = '2026-11-23T00:00:00.000Z'

// The auth service owns end users and is mocked: these tests cover who may
// call the routes, what they check and what they pass to auth.
describe('End users', () => {
  let server: Server
  let baseUrl: string
  let organizationId: string
  let caller: UserWithOrganization
  let enrollInAuth: jest.SpiedFunction<
    typeof AuthManager.enrollOrganizationEndUsers
  >
  let listInAuth: jest.SpiedFunction<
    typeof AuthManager.listOrganizationEndUsers
  >
  let removeInAuth: jest.SpiedFunction<
    typeof AuthManager.removeOrganizationEndUser
  >

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

  // Callers, for the organization of the test.
  const orgAdmin = () => ({
    ...createMockUser(),
    publicId: 'org-admin',
    organizationId,
  })
  const member = () => ({ ...orgAdmin(), publicId: 'org-member' })
  const orgKey = (
    apiKeyScopes: ApiKeyScope[] | null,
    ofOrganization = organizationId,
  ): UserWithOrganization => ({
    ...createMockUser(),
    oauthProvider: SERVICE_USER_PROVIDER,
    oauthUserId: ofOrganization,
    organizationId: ofOrganization,
    apiKeyId: 'org-key',
    apiKeyScopes,
  })
  const autoDriveAdmin = () => ({ ...createMockUser(), role: UserRole.Admin })

  beforeEach(() => {
    organizationId = `partner-${v4()}`
    caller = orgKey(null)
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
    jest.spyOn(AuthManager, 'getOrganization').mockImplementation(async (id) =>
      ok({
        id,
        name: 'Partner',
        archivedAt: null,
        members: ['org-admin', 'org-member'],
        memberships: [
          { publicId: 'org-admin', role: OrganizationRole.Admin },
          { publicId: 'org-member', role: OrganizationRole.Member },
        ],
      } as OrganizationWithMembers),
    )
    enrollInAuth = jest
      .spyOn(AuthManager, 'enrollOrganizationEndUsers')
      .mockImplementation(async (_id, endUsers) =>
        ok(
          endUsers.map((endUser) => ({
            ...endUser,
            publicId: `pub-${endUser.address}`,
            createdAt: CREATED_AT,
            removedAt: null,
          })),
        ),
      )
    listInAuth = jest
      .spyOn(AuthManager, 'listOrganizationEndUsers')
      .mockResolvedValue(ok({ endUsers: [], totalCount: 0 }))
    removeInAuth = jest
      .spyOn(AuthManager, 'removeOrganizationEndUser')
      .mockResolvedValue(ok(undefined))
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const headers = {
    authorization: 'Bearer token',
    'x-auth-provider': 'apikey',
    'content-type': 'application/json',
  }
  const enroll = (endUsers: unknown, organization = organizationId) =>
    fetch(`${baseUrl}/organizations/${organization}/end-users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ endUsers }),
    })
  const list = (query = '', organization = organizationId) =>
    fetch(`${baseUrl}/organizations/${organization}/end-users${query}`, {
      headers,
    })
  const remove = (address: string, organization = organizationId) =>
    fetch(`${baseUrl}/organizations/${organization}/end-users/${address}`, {
      method: 'DELETE',
      headers,
    })

  it.each([
    ['an organization admin, signed in', orgAdmin, [201, 200, 204]],
    ['a member, signed in', member, [403, 403, 403]],
    ['the organization key', () => orgKey(null), [201, 200, 204]],
    [
      'the organization key with end_users',
      () => orgKey([ApiKeyScope.EndUsers]),
      [201, 200, 204],
    ],
    [
      'the organization key with files only',
      () => orgKey([ApiKeyScope.Files]),
      [403, 403, 403],
    ],
    [
      'a key of another organization',
      () => orgKey(null, 'partner-other'),
      [403, 403, 403],
    ],
    [
      'a personal key of an organization admin',
      () => ({ ...orgAdmin(), apiKeyId: 'personal-key' }),
      [403, 403, 403],
    ],
    ['an Auto Drive admin, signed in', autoDriveAdmin, [403, 200, 204]],
    [
      'a personal key of an Auto Drive admin',
      () => ({ ...autoDriveAdmin(), apiKeyId: 'personal-key' }),
      [403, 403, 403],
    ],
  ])('answers enroll, list and remove from %s', async (_, as, statuses) => {
    caller = as()
    const { input } = newAddress()

    const responses = [
      await enroll([{ address: input, customerReference: 'customer-1' }]),
      await list(),
      await remove(newAddress().input),
    ]

    expect(responses.map((r) => r.status)).toEqual(statuses)
    const calls = [enrollInAuth, listInAuth, removeInAuth].map(
      (mock) => mock.mock.calls.length,
    )
    expect(calls).toEqual(statuses.map((status) => (status === 403 ? 0 : 1)))
  })

  it('answers 404 for an organization that is not a partner', async () => {
    organizationId = `personal-${v4()}`
    caller = orgAdmin()

    const responses = [
      await enroll([{ address: newAddress().input, customerReference: 'c' }]),
      await list(),
      await remove(newAddress().input),
    ]

    expect(responses.map((r) => r.status)).toEqual([404, 404, 404])
    expect(enrollInAuth).not.toHaveBeenCalled()
    expect(listInAuth).not.toHaveBeenCalled()
    expect(removeInAuth).not.toHaveBeenCalled()
  })

  it('enrolls end users in auth under their checksummed addresses, with the cap', async () => {
    caller = orgAdmin()
    const [first, second] = [newAddress(), newAddress()]

    const response = await enroll([
      { address: first.input, customerReference: 'customer-1' },
      {
        address: second.input,
        customerReference: 'customer:2',
        uploadQuotaBytes: 1024,
      },
    ])

    expect(response.status).toBe(201)
    const requested = [
      {
        address: first.address,
        customerReference: 'customer-1',
        uploadQuotaBytes: null,
      },
      {
        address: second.address,
        customerReference: 'customer:2',
        uploadQuotaBytes: 1024,
      },
    ]
    expect(enrollInAuth).toHaveBeenCalledWith(
      organizationId,
      requested,
      config.params.partnerMaxEndUsers,
      'org-admin',
    )
    expect(await response.json()).toEqual({
      endUsers: requested.map((r) => ({
        ...r,
        publicId: `pub-${r.address}`,
        createdAt: CREATED_AT,
        removedAt: null,
      })),
    })
  })

  it('passes the configured cap to auth', async () => {
    const max = config.params.partnerMaxEndUsers
    config.params.partnerMaxEndUsers = 2
    try {
      const { input, address } = newAddress()
      expect(
        (await enroll([{ address: input, customerReference: 'c1' }])).status,
      ).toBe(201)
      expect(enrollInAuth).toHaveBeenCalledWith(
        organizationId,
        [expect.objectContaining({ address })],
        2,
        expect.any(String),
      )
    } finally {
      config.params.partnerMaxEndUsers = max
    }
  })

  it('validates the request before calling auth', async () => {
    const { input } = newAddress()
    const valid = { address: input, customerReference: 'customer-1' }

    for (const endUsers of [
      undefined,
      [],
      Array.from({ length: 101 }, () => ({
        address: newAddress().input,
        customerReference: v4(),
      })),
      [{ address: input }],
      [{ ...valid, customerReference: 'has space' }],
      [{ ...valid, customerReference: 'x'.repeat(129) }],
      [{ ...valid, uploadQuotaBytes: 0 }],
      [{ ...valid, uploadQuotaBytes: 1.5 }],
      [{ ...valid, uploadQuotaBytes: '1024' }],
      [{ ...valid, address: '0x1234' }],
      // From EIP-55, with the case of its last letter changed.
      [{ ...valid, address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD' }],
      // The same address twice, once checksummed.
      [valid, { address: getAddress(input), customerReference: 'customer-2' }],
      [valid, { address: newAddress().input, customerReference: 'customer-1' }],
    ]) {
      const response = await enroll(endUsers)
      expect([endUsers, response.status]).toEqual([endUsers, 400])
    }
    expect(enrollInAuth).not.toHaveBeenCalled()
  })

  it('passes on what auth refuses', async () => {
    const { input, address } = newAddress()
    const conflicts = [
      `${address} is already an Auto Drive user`,
      'Customer reference customer-1 is already used by another end user',
      'An organization can have at most 2 end users: it has 2, and this would add 1',
    ]
    for (const message of conflicts) {
      enrollInAuth.mockResolvedValueOnce(err(new ConflictError(message)))
      const refused = await enroll([
        { address: input, customerReference: 'customer-1' },
      ])
      expect(refused.status).toBe(409)
      expect(await refused.json()).toEqual({ error: message })
    }

    listInAuth.mockResolvedValueOnce(
      err(new NotFoundError('Organization not found')),
    )
    expect((await list()).status).toBe(404)
    removeInAuth.mockResolvedValueOnce(
      err(new NotFoundError('Not an end user of this organization')),
    )
    const notEndUser = await remove(input)
    expect(notEndUser.status).toBe(404)
    expect(await notEndUser.json()).toEqual({
      error: 'Not an end user of this organization',
    })
  })

  it('removes an end user in auth, and answers 204 again once removed', async () => {
    const { input, address } = newAddress()
    const admin = autoDriveAdmin()
    caller = admin

    // Auth answers 204 both times: the second removal changes nothing.
    expect((await remove(input)).status).toBe(204)
    expect((await remove(address)).status).toBe(204)

    expect(removeInAuth.mock.calls).toEqual([
      [organizationId, address, admin.publicId],
      [organizationId, address, admin.publicId],
    ])
    expect((await remove('not-an-address')).status).toBe(400)
    expect(removeInAuth).toHaveBeenCalledTimes(2)
  })

  it('lists end users from auth a page at a time', async () => {
    const page = {
      endUsers: [
        {
          address: newAddress().address,
          publicId: 'pub-1',
          customerReference: 'customer-1',
          uploadQuotaBytes: null,
          createdAt: CREATED_AT,
          removedAt: CREATED_AT,
        },
      ] satisfies PartnerEndUser[],
      totalCount: 3,
    }
    listInAuth.mockResolvedValue(ok(page))

    const defaults = await list()
    expect(defaults.status).toBe(200)
    expect(await defaults.json()).toEqual(page)
    expect((await list('?limit=2&offset=2')).status).toBe(200)
    expect(listInAuth.mock.calls).toEqual([
      [organizationId, { limit: 100, offset: 0 }],
      [organizationId, { limit: 2, offset: 2 }],
    ])

    for (const query of ['?limit=0', '?limit=501', '?offset=-1', '?limit=a']) {
      expect([query, (await list(query)).status]).toEqual([query, 400])
    }
    expect(listInAuth).toHaveBeenCalledTimes(2)
  })
})
