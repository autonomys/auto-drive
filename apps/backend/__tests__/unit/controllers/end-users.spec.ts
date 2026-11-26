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
// The per-person maximum of every partner account in these tests.
const MAX_QUOTA = 10_000

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
  let setQuotaInAuth: jest.SpiedFunction<
    typeof AuthManager.setOrganizationEndUserQuota
  >
  let setMaxInRepository: jest.SpiedFunction<
    typeof accountsRepository.setMaxEndUserQuota
  >
  let setDailyInRepository: jest.SpiedFunction<
    typeof accountsRepository.setDailyUploadLimit
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
          maxEndUserQuotaBytes: MAX_QUOTA,
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
            closedAt: null,
          })),
        ),
      )
    listInAuth = jest
      .spyOn(AuthManager, 'listOrganizationEndUsers')
      .mockResolvedValue(ok({ endUsers: [], totalCount: 0 }))
    removeInAuth = jest
      .spyOn(AuthManager, 'removeOrganizationEndUser')
      .mockResolvedValue(ok(undefined))
    setQuotaInAuth = jest
      .spyOn(AuthManager, 'setOrganizationEndUserQuota')
      .mockImplementation(async (_id, address, uploadQuotaBytes) =>
        ok({
          address,
          publicId: `pub-${address}`,
          customerReference: 'customer-1',
          uploadQuotaBytes,
          createdAt: CREATED_AT,
          removedAt: null,
          closedAt: null,
        }),
      )
    setMaxInRepository = jest
      .spyOn(accountsRepository, 'setMaxEndUserQuota')
      .mockImplementation(
        async (id, maxEndUserQuotaBytes) =>
          ({ id, maxEndUserQuotaBytes }) as Account,
      )
    setDailyInRepository = jest
      .spyOn(accountsRepository, 'setDailyUploadLimit')
      .mockImplementation(
        async (id, dailyUploadLimitBytes) =>
          ({
            id,
            dailyUploadLimitBytes,
            dailyUploadLimitOff: dailyUploadLimitBytes === null,
          }) as Account,
      )
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
      'the organization key with both end user scopes',
      () => orgKey([ApiKeyScope.EndUserEnrollment, ApiKeyScope.EndUserRemoval]),
      [201, 200, 204],
    ],
    [
      'the organization key with end_user_enrollment',
      () => orgKey([ApiKeyScope.EndUserEnrollment]),
      [201, 200, 403],
    ],
    [
      'the organization key with end_user_removal',
      () => orgKey([ApiKeyScope.EndUserRemoval]),
      [403, 200, 204],
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
      null,
    )
    expect(await response.json()).toEqual({
      endUsers: requested.map((r) => ({
        ...r,
        publicId: `pub-${r.address}`,
        createdAt: CREATED_AT,
        removedAt: null,
        closedAt: null,
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
        'org-key',
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
    const { input } = newAddress()
    const conflicts = [
      'An entry conflicts with an existing user or end user',
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
      [organizationId, address, admin.publicId, null],
      [organizationId, address, admin.publicId, null],
    ])
    // A key's removal records which key it was.
    caller = orgKey([ApiKeyScope.EndUserRemoval])
    expect((await remove(address)).status).toBe(204)
    expect(removeInAuth).toHaveBeenLastCalledWith(
      organizationId,
      address,
      caller.publicId,
      'org-key',
    )
    caller = admin
    expect((await remove('not-an-address')).status).toBe(400)
    expect(removeInAuth).toHaveBeenCalledTimes(3)
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
          closedAt: null,
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

  describe('quotas', () => {
    const setQuota = (
      address: string,
      body: unknown,
      organization = organizationId,
    ) =>
      fetch(`${baseUrl}/organizations/${organization}/end-users/${address}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
    const setMax = (body: unknown, organization = organizationId) =>
      fetch(`${baseUrl}/organizations/${organization}/max-end-user-quota`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
    const setDaily = (body: unknown, organization = organizationId) =>
      fetch(`${baseUrl}/organizations/${organization}/daily-upload-limit`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })

    it.each([
      ['an organization admin, signed in', orgAdmin, [200, 200]],
      ['a member, signed in', member, [403, 403]],
      ['the organization key', () => orgKey(null), [200, 403]],
      [
        'the organization key with end_user_enrollment',
        () => orgKey([ApiKeyScope.EndUserEnrollment]),
        [200, 403],
      ],
      [
        'the organization key with end_user_removal',
        () => orgKey([ApiKeyScope.EndUserRemoval]),
        [403, 403],
      ],
      [
        'the organization key with usage',
        () => orgKey([ApiKeyScope.Usage]),
        [403, 403],
      ],
      [
        'a key of another organization',
        () => orgKey(null, 'partner-other'),
        [403, 403],
      ],
      [
        'a personal key of an organization admin',
        () => ({ ...orgAdmin(), apiKeyId: 'personal-key' }),
        [403, 403],
      ],
      ['an Auto Drive admin, signed in', autoDriveAdmin, [403, 403]],
    ])(
      'answers a quota change, the maximum and the daily limit from %s',
      async (_, as, [quotaStatus, settingStatus]) => {
        caller = as()
        // The daily upload limit has the same callers as the maximum.
        const statuses = [quotaStatus, settingStatus, settingStatus]

        const responses = [
          await setQuota(newAddress().input, { uploadQuotaBytes: 100 }),
          await setMax({ maxEndUserQuotaBytes: 5000 }),
          await setDaily({ dailyUploadLimitBytes: 5000 }),
        ]

        expect(responses.map((r) => r.status)).toEqual(statuses)
        expect(
          [setQuotaInAuth, setMaxInRepository, setDailyInRepository].map(
            (mock) => mock.mock.calls.length,
          ),
        ).toEqual(statuses.map((status) => (status === 403 ? 0 : 1)))
      },
    )

    it('changes a quota in auth, up to the maximum, recording the key', async () => {
      caller = orgKey([ApiKeyScope.EndUserEnrollment])
      const { input, address } = newAddress()

      const response = await setQuota(input, { uploadQuotaBytes: MAX_QUOTA })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(
        expect.objectContaining({ address, uploadQuotaBytes: MAX_QUOTA }),
      )
      expect((await setQuota(input, { uploadQuotaBytes: null })).status).toBe(
        200,
      )
      expect(setQuotaInAuth.mock.calls).toEqual([
        [organizationId, address, MAX_QUOTA, caller.publicId, 'org-key'],
        [organizationId, address, null, caller.publicId, 'org-key'],
      ])

      const above = await setQuota(input, { uploadQuotaBytes: MAX_QUOTA + 1 })
      expect(above.status).toBe(400)
      expect((await above.json()).error).toContain(String(MAX_QUOTA))
      for (const body of [
        {},
        { uploadQuotaBytes: 0 },
        { uploadQuotaBytes: -1 },
        { uploadQuotaBytes: 1.5 },
        { uploadQuotaBytes: '100' },
      ]) {
        expect([body, (await setQuota(input, body)).status]).toEqual([
          body,
          400,
        ])
      }
      expect(
        (await setQuota('not-an-address', { uploadQuotaBytes: 1 })).status,
      ).toBe(400)
      expect(setQuotaInAuth).toHaveBeenCalledTimes(2)

      setQuotaInAuth.mockResolvedValueOnce(
        err(new NotFoundError('Not an active end user of this organization')),
      )
      expect((await setQuota(input, { uploadQuotaBytes: 1 })).status).toBe(404)
    })

    it('refuses to enroll anyone with a quota above the maximum', async () => {
      caller = orgKey([ApiKeyScope.EndUserEnrollment])

      const above = await enroll([
        { address: newAddress().input, customerReference: 'c1' },
        {
          address: newAddress().input,
          customerReference: 'c2',
          uploadQuotaBytes: MAX_QUOTA + 1,
        },
      ])
      expect(above.status).toBe(400)
      expect(enrollInAuth).not.toHaveBeenCalled()

      const atMax = await enroll([
        {
          address: newAddress().input,
          customerReference: 'c3',
          uploadQuotaBytes: MAX_QUOTA,
        },
      ])
      expect(atMax.status).toBe(201)
    })

    it('lets an organization admin set the maximum on the account', async () => {
      caller = orgAdmin()

      const response = await setMax({ maxEndUserQuotaBytes: 0 })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ maxEndUserQuotaBytes: 0 })
      expect(setMaxInRepository).toHaveBeenCalledWith(
        `account-${organizationId}`,
        0,
        'org-admin',
      )

      for (const body of [
        {},
        { maxEndUserQuotaBytes: -1 },
        { maxEndUserQuotaBytes: 1.5 },
        { maxEndUserQuotaBytes: '1' },
      ]) {
        expect([body, (await setMax(body)).status]).toEqual([body, 400])
      }
      expect(setMaxInRepository).toHaveBeenCalledTimes(1)

      organizationId = `personal-${v4()}`
      caller = orgAdmin()
      expect((await setMax({ maxEndUserQuotaBytes: 1 })).status).toBe(404)
    })

    it('lets an organization admin set the daily upload limit, and switch it off only with the acknowledgement', async () => {
      caller = orgAdmin()

      const set = await setDaily({ dailyUploadLimitBytes: 0 })
      expect(set.status).toBe(200)
      expect(await set.json()).toEqual({
        dailyUploadLimitBytes: 0,
        dailyUploadLimitOff: false,
      })

      for (const body of [
        {},
        { dailyUploadLimitBytes: null },
        { dailyUploadLimitBytes: null, acknowledgeNoDailyLimit: 'true' },
        { dailyUploadLimitBytes: null, acknowledgeNoDailyLimit: false },
        { dailyUploadLimitBytes: -1 },
        { dailyUploadLimitBytes: 1.5 },
        { dailyUploadLimitBytes: '1' },
      ]) {
        expect([body, (await setDaily(body)).status]).toEqual([body, 400])
      }

      const off = await setDaily({
        dailyUploadLimitBytes: null,
        acknowledgeNoDailyLimit: true,
      })
      expect(off.status).toBe(200)
      expect(await off.json()).toEqual({
        dailyUploadLimitBytes: null,
        dailyUploadLimitOff: true,
      })
      expect(setDailyInRepository.mock.calls).toEqual([
        [`account-${organizationId}`, 0, 'org-admin'],
        [`account-${organizationId}`, null, 'org-admin'],
      ])

      organizationId = `personal-${v4()}`
      caller = orgAdmin()
      expect((await setDaily({ dailyUploadLimitBytes: 1 })).status).toBe(404)
    })
  })
})
