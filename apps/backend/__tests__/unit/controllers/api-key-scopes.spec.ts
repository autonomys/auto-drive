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
import express, { Request, Response } from 'express'
import { AddressInfo } from 'net'
import { Server } from 'http'
import { ok } from 'neverthrow'
import {
  ApiKey,
  ApiKeyScope,
  UsageReport,
  UserWithOrganization,
} from '@auto-drive/models'
import { uploadController } from '../../../src/app/controllers/upload.js'
import { objectController } from '../../../src/app/controllers/object.js'
import { downloadController } from '../../../src/app/controllers/download.js'
import { accountController } from '../../../src/app/controllers/accounts.js'
import { organizationsController } from '../../../src/app/controllers/organizations.js'
import { s3Controller } from '../../../src/app/controllers/s3/http.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { AsyncDownloadsUseCases } from '../../../src/core/downloads/index.js'
import { ObjectUseCases } from '../../../src/core/index.js'
import { OrganizationsUseCases } from '../../../src/core/users/organizations.js'
import { UsageReportsUseCases } from '../../../src/core/users/usageReports.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import {
  requireApiKeyScope,
  tryAuthenticate,
} from '../../../src/infrastructure/services/auth/express.js'
import { createMockUser } from '../../utils/mocks.js'

// A key limited to scopes reaches only the routes that declare one of them.
// Sessions and keys with full access reach every route as before.
describe('API key scopes', () => {
  let server: Server
  let baseUrl: string
  let user: UserWithOrganization

  beforeAll(async () => {
    // Mounted as the frontend and download APIs mount them.
    const app = express()
    app.use('/uploads', uploadController)
    app.use(express.json())
    app.use('/objects', objectController)
    app.use('/accounts', accountController)
    app.use('/organizations', organizationsController)
    app.use('/downloads', downloadController)
    app.use('/s3', s3Controller)
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  beforeEach(() => {
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockImplementation(async () => user)
    // What each route does once the caller is let in.
    jest
      .spyOn(ObjectUseCases, 'getRootObjects')
      .mockResolvedValue({ rows: [], totalCount: 0 })
    jest
      .spyOn(AsyncDownloadsUseCases, 'getDownloadsByUser')
      .mockResolvedValue([])
    jest
      .spyOn(AccountsUseCases, 'getAccountInfo')
      .mockResolvedValue({} as never)
    jest
      .spyOn(UsageReportsUseCases, 'getUsageReport')
      .mockResolvedValue(ok({} as UsageReport))
    jest
      .spyOn(UsageReportsUseCases, 'getUsageInteractions')
      .mockImplementation(async (_user, _accountId, range) =>
        ok({ ...range, pages: (async function* () {})() }),
      )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const session = () => createMockUser()
  const keyWith = (apiKeyScopes?: ApiKeyScope[] | null) => ({
    ...createMockUser(),
    apiKeyId: 'key',
    apiKeyScopes,
  })

  const headers = { authorization: 'Bearer token', 'x-auth-provider': 'apikey' }
  const range = 'from=2026-11-01&to=2026-11-02'
  // Each route, and its status once the caller is let in.
  const routes = {
    upload: () =>
      fetch(`${baseUrl}/uploads/file`, { method: 'POST', headers }).then(
        // No filename: refused after authentication.
        (r) => [r, 400] as const,
      ),
    objects: () =>
      fetch(`${baseUrl}/objects/roots?scope=user`, { headers }).then(
        (r) => [r, 200] as const,
      ),
    downloads: () =>
      fetch(`${baseUrl}/downloads/async/@me`, { headers }).then(
        (r) => [r, 200] as const,
      ),
    s3: () =>
      // ListParts, which is not implemented, once authenticated. S3 reads the
      // access key from a SigV4 header.
      fetch(`${baseUrl}/s3/bucket/key?uploadId=1`, {
        headers: {
          authorization:
            'AWS4-HMAC-SHA256 Credential=key/20261120/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=0',
        },
      }).then((r) => [r, 501] as const),
    usageReport: () =>
      fetch(`${baseUrl}/accounts/a/usage-report?${range}`, { headers }).then(
        (r) => [r, 200] as const,
      ),
    usageInteractions: () =>
      fetch(`${baseUrl}/accounts/a/usage-report/interactions?${range}`, {
        headers,
      }).then((r) => [r, 200] as const),
    account: () =>
      fetch(`${baseUrl}/accounts/@me`, { headers }).then(
        (r) => [r, 200] as const,
      ),
  }
  type Route = keyof typeof routes
  const all = Object.keys(routes) as Route[]
  const files: Route[] = ['upload', 'objects', 'downloads', 's3']
  const usage: Route[] = ['usageReport', 'usageInteractions', 'account']

  it.each([
    ['a session', session(), all],
    ['a key with full access', keyWith(null), all],
    ['a key from before scopes', keyWith(undefined), all],
    ['a files key', keyWith([ApiKeyScope.Files]), files],
    ['a usage key', keyWith([ApiKeyScope.Usage]), usage],
    ['an end users key', keyWith([ApiKeyScope.EndUsers]), []],
    [
      'a files and usage key',
      keyWith([ApiKeyScope.Files, ApiKeyScope.Usage]),
      [...files, ...usage],
    ],
  ])('lets %s reach only its routes', async (_, caller, allowed) => {
    user = caller

    for (const route of all) {
      const [response, status] = await routes[route]()
      expect([route, response.status]).toEqual([
        route,
        allowed.includes(route) ? status : 403,
      ])
    }
  })

  it('says why a key is refused', async () => {
    user = keyWith([ApiKeyScope.EndUsers])
    const [objects] = await routes.objects()
    expect(await objects.json()).toEqual({
      error: 'This API key needs the files scope (it has: end_users)',
    })
    const [s3] = await routes.s3()
    expect(await s3.text()).toContain('<Code>AccessDenied</Code>')
    expect(ObjectUseCases.getRootObjects).not.toHaveBeenCalled()

    // A route that declares no scope.
    user = keyWith([ApiKeyScope.Usage])
    const adminUsage = await fetch(`${baseUrl}/accounts/admin/usage`, {
      headers,
    })
    expect(adminUsage.status).toBe(403)
    expect(await adminUsage.json()).toEqual({
      error:
        'Not available to API keys limited to scopes (this key has: usage)',
    })
  })

  it('treats a key that may not be used on a route as no credential there', async () => {
    const req = { headers } as unknown as Request
    user = keyWith([ApiKeyScope.Files])
    expect(await tryAuthenticate(req)).toBeNull()

    requireApiKeyScope(ApiKeyScope.Files)(req, {} as Response, () => {})
    expect(await tryAuthenticate(req)).toBe(user)
  })

  it('creates organization keys with the scopes asked for', async () => {
    user = session()
    const create = jest
      .spyOn(OrganizationsUseCases, 'createApiKey')
      .mockResolvedValue(ok({ id: 'org-key' } as ApiKey))
    const post = (body: unknown) =>
      fetch(`${baseUrl}/organizations/org/api-keys`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    expect((await post({ scopes: ['files', 'admin'] })).status).toBe(400)
    expect((await post({ scopes: 'files' })).status).toBe(400)
    expect(create).not.toHaveBeenCalled()

    expect((await post({ name: 'Usage', scopes: ['usage'] })).status).toBe(201)
    expect((await post({ name: 'All' })).status).toBe(201)
    expect(create.mock.calls.map(([, , input]) => input)).toEqual([
      { name: 'Usage', scopes: [ApiKeyScope.Usage] },
      { name: 'All' },
    ])
  })
})
