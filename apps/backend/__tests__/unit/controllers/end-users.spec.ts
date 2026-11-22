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
  EndUser,
  OrganizationRole,
  OrganizationWithMembers,
  SERVICE_USER_PROVIDER,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { organizationsController } from '../../../src/app/controllers/organizations.js'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { endUsersRepository } from '../../../src/infrastructure/repositories/users/endUsers.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { ConflictError, NotFoundError } from '../../../src/errors/index.js'
import { config } from '../../../src/config.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { createMockUser } from '../../utils/mocks.js'

// A lower-case address, as a client may send it, and its EIP-55 form.
const newAddress = () => {
  const address = `0x${v4().replace(/-/g, '')}${v4().slice(0, 8)}`
  return { input: address, address: getAddress(address) }
}

// Runs against the migrated TestContainers Postgres (requires Docker), with
// the auth service mocked.
describe('End users', () => {
  let server: Server
  let baseUrl: string
  let organizationId: string
  let caller: UserWithOrganization
  let enrollInAuth: jest.SpiedFunction<
    typeof AuthManager.enrollOrganizationEndUsers
  >
  let removeInAuth: jest.SpiedFunction<
    typeof AuthManager.removeOrganizationEndUser
  >

  beforeAll(async () => {
    await dbMigration.up()
    const app = express()
    app.use(express.json())
    app.use('/organizations', organizationsController)
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await dbMigration.down()
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
      .mockImplementation(async (_id, addresses) =>
        ok(
          addresses.map((address) => ({ address, publicId: `pub-${address}` })),
        ),
      )
    removeInAuth = jest
      .spyOn(AuthManager, 'removeOrganizationEndUser')
      .mockResolvedValue(ok({ organizationId: 'personal' }))
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
  const listed = async (query = '') =>
    (await (await list(query)).json()) as {
      endUsers: EndUser[]
      totalCount: number
    }

  it.each([
    ['an organization admin, signed in', orgAdmin, [201, 200, 404]],
    ['a member, signed in', member, [403, 403, 403]],
    ['the organization key', () => orgKey(null), [201, 200, 404]],
    [
      'the organization key with end_users',
      () => orgKey([ApiKeyScope.EndUsers]),
      [201, 200, 404],
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
    ['an Auto Drive admin, signed in', autoDriveAdmin, [403, 200, 404]],
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
      // An address that is not enrolled: 404 once let in.
      await remove(newAddress().input),
    ]

    expect(responses.map((r) => r.status)).toEqual(statuses)
    if (statuses[0] === 403) expect(enrollInAuth).not.toHaveBeenCalled()
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
  })

  it('enrolls end users under their checksummed addresses', async () => {
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
    const { endUsers } = (await response.json()) as { endUsers: EndUser[] }
    expect(endUsers).toEqual([
      {
        address: first.address,
        publicId: `pub-${first.address}`,
        customerReference: 'customer-1',
        uploadQuotaBytes: null,
        createdAt: expect.any(String),
      },
      {
        address: second.address,
        publicId: `pub-${second.address}`,
        customerReference: 'customer:2',
        uploadQuotaBytes: 1024,
        createdAt: expect.any(String),
      },
    ])
    expect(enrollInAuth).toHaveBeenCalledWith(
      organizationId,
      [first.address, second.address],
      'org-admin',
    )
    expect(await listed()).toEqual({ endUsers, totalCount: 2 })
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

  it('returns end users already enrolled and refuses conflicting ones', async () => {
    const [first, second, third] = [newAddress(), newAddress(), newAddress()]
    const [enrolled] = (
      (await (
        await enroll([
          { address: first.input, customerReference: 'customer-1' },
        ])
      ).json()) as { endUsers: EndUser[] }
    ).endUsers

    const again = await enroll([
      { address: second.input, customerReference: 'customer-2' },
      // Unchanged, though asked with another quota.
      {
        address: first.address,
        customerReference: 'customer-1',
        uploadQuotaBytes: 5,
      },
    ])
    expect(again.status).toBe(201)
    const { endUsers } = (await again.json()) as { endUsers: EndUser[] }
    expect(endUsers[1]).toEqual(enrolled)
    expect(enrollInAuth).toHaveBeenLastCalledWith(
      organizationId,
      [second.address],
      expect.any(String),
    )

    enrollInAuth.mockClear()
    const conflicts = [
      // Enrolled with another reference.
      [{ address: first.input, customerReference: 'customer-9' }],
      // A reference another end user has.
      [{ address: third.input, customerReference: 'customer-1' }],
    ]
    for (const endUsers of conflicts) {
      expect((await enroll(endUsers)).status).toBe(409)
    }
    expect(enrollInAuth).not.toHaveBeenCalled()
    expect((await listed()).totalCount).toBe(2)
  })

  it('passes on what auth refuses, and completes on a retry', async () => {
    const { input, address } = newAddress()
    const body = [{ address: input, customerReference: 'customer-1' }]
    enrollInAuth.mockResolvedValueOnce(
      err(new ConflictError(`${address} is already an Auto Drive user`)),
    )
    const refused = await enroll(body)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({
      error: `${address} is already an Auto Drive user`,
    })

    // Auth enrolled them, then recording them here failed.
    jest
      .spyOn(endUsersRepository, 'insertEndUsers')
      .mockRejectedValueOnce(new Error('connection lost'))
    expect((await enroll(body)).status).toBe(500)
    expect((await listed()).totalCount).toBe(0)

    expect((await enroll(body)).status).toBe(201)
    expect(enrollInAuth).toHaveBeenCalledTimes(3)
    expect((await listed()).endUsers.map((e) => e.address)).toEqual([address])
  })

  it('refuses an enrollment raced by a concurrent one', async () => {
    const { input } = newAddress()
    await enroll([{ address: input, customerReference: 'customer-1' }])
    // As if the check ran before the concurrent request inserted its row.
    jest
      .spyOn(endUsersRepository, 'getActiveByAddressesOrReferences')
      .mockResolvedValueOnce([])

    const raced = await enroll([
      { address: newAddress().input, customerReference: 'customer-1' },
    ])

    expect(raced.status).toBe(409)
    expect((await listed()).totalCount).toBe(1)
  })

  it('caps the end users of an organization', async () => {
    const max = config.params.partnerMaxEndUsers
    config.params.partnerMaxEndUsers = 2
    try {
      const [first, second, third] = [newAddress(), newAddress(), newAddress()]
      expect(
        (
          await enroll([
            { address: first.input, customerReference: 'c1' },
            { address: second.input, customerReference: 'c2' },
          ])
        ).status,
      ).toBe(201)

      const over = await enroll([
        { address: third.input, customerReference: 'c3' },
      ])
      expect(over.status).toBe(409)
      expect(await over.json()).toEqual({
        error:
          'An organization can have at most 2 end users: it has 2, and this would add 1',
      })
      // Nothing new to enroll.
      expect(
        (await enroll([{ address: first.input, customerReference: 'c1' }]))
          .status,
      ).toBe(201)

      expect((await remove(second.input)).status).toBe(204)
      expect(
        (await enroll([{ address: third.input, customerReference: 'c3' }]))
          .status,
      ).toBe(201)
    } finally {
      config.params.partnerMaxEndUsers = max
    }
  })

  it('lists active end users a page at a time', async () => {
    const addresses = Array.from({ length: 5 }, () => newAddress())
    await enroll(
      addresses
        .slice(0, 3)
        .map((a, i) => ({ address: a.input, customerReference: `c${i}` })),
    )
    await enroll(
      addresses
        .slice(3)
        .map((a, i) => ({ address: a.input, customerReference: `c${i + 3}` })),
    )
    await remove(addresses[1].input)
    const active = [0, 2, 3, 4].map((i) => addresses[i].address)

    expect((await listed()).endUsers.map((e) => e.address)).toEqual(active)
    const pages = [
      await listed('?limit=2'),
      await listed('?limit=2&offset=2'),
      await listed('?limit=2&offset=4'),
    ]
    expect(pages.map((p) => p.endUsers.map((e) => e.address))).toEqual([
      active.slice(0, 2),
      active.slice(2),
      [],
    ])
    expect(pages.map((p) => p.totalCount)).toEqual([4, 4, 4])

    for (const query of ['?limit=0', '?limit=501', '?offset=-1', '?limit=a']) {
      expect([query, (await list(query)).status]).toEqual([query, 400])
    }
  })

  it('removes an end user from auth, then here', async () => {
    const { input, address } = newAddress()
    caller = orgKey([ApiKeyScope.EndUsers])
    await enroll([{ address: input, customerReference: 'customer-1' }])
    const admin = autoDriveAdmin()
    caller = admin

    expect((await remove(input)).status).toBe(204)

    expect(removeInAuth).toHaveBeenCalledWith(
      organizationId,
      `pub-${address}`,
      admin.publicId,
    )
    expect(await listed()).toEqual({ endUsers: [], totalCount: 0 })
    expect((await remove(address)).status).toBe(404)
    expect(removeInAuth).toHaveBeenCalledTimes(1)
    expect((await remove('not-an-address')).status).toBe(400)

    // Removed, the address and reference can be enrolled again.
    caller = orgKey(null)
    expect(
      (await enroll([{ address: input, customerReference: 'customer-1' }]))
        .status,
    ).toBe(201)
  })

  it('completes a removal that auth already made', async () => {
    const [removed, refused] = [newAddress(), newAddress()]
    await enroll([
      { address: removed.input, customerReference: 'customer-1' },
      { address: refused.input, customerReference: 'customer-2' },
    ])
    removeInAuth
      .mockResolvedValueOnce(err(new NotFoundError('Not an end user')))
      .mockResolvedValueOnce(err(new ConflictError('Refused')))

    expect((await remove(removed.input)).status).toBe(204)
    expect((await remove(refused.input)).status).toBe(409)

    expect((await listed()).endUsers.map((e) => e.address)).toEqual([
      refused.address,
    ])
  })
})
