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
import { ok } from 'neverthrow'
import { UsageInteraction, UserRole } from '@auto-drive/models'
import { accountController } from '../../../src/app/controllers/accounts.js'
import { UsageReportsUseCases } from '../../../src/core/users/usageReports.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { createMockUser } from '../../utils/mocks.js'

// The usage report routes over HTTP: query parsing and the streamed export.
// The figures themselves are tested on the use cases (e2e/users/usageReport).
describe('Usage report routes', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    const app = express()
    app.use('/accounts', accountController)
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
      .mockResolvedValue({ ...createMockUser(), role: UserRole.Admin })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const get = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { authorization: 'Bearer token', 'x-auth-provider': 'apikey' },
    })

  const interaction = (id: string): UsageInteraction => ({
    id,
    createdAt: '2026-11-01T00:00:00.000Z',
    type: 'upload',
    source: 'purchased',
    bytes: '10',
    cid: `cid-${id}`,
    apiKeyId: null,
    apiKeyName: null,
    ai3Value: '20',
  })

  const mockPages = (
    pages: () => AsyncGenerator<UsageInteraction[]>,
    before?: () => Promise<void>,
  ) =>
    jest
      .spyOn(UsageReportsUseCases, 'getUsageInteractions')
      .mockImplementation(async (_user, _accountId, range) => {
        await before?.()
        return ok({ ...range, pages: pages() })
      })

  it.each([
    [
      '/accounts/a/usage-report?from=2026-02-30&to=2026-04-31',
      'from: is not a valid date; to: is not a valid date',
    ],
    [
      '/accounts/a/usage-report?from=2026-01-01T00:00:00.000001Z&to=2026-02-01',
      'from: must be an ISO 8601 date, or a date and time with Z or an offset',
    ],
    [
      '/accounts/a/usage-report?from=2026-01-01&to=2026-02-01&format=csv',
      'table: format=csv needs one of summary|apiKeys|purchases',
    ],
    [
      '/accounts/a/usage-report/interactions?from=2026-01-01&to=2026-02-01&format=xml',
      expect.stringMatching(/^format: Invalid enum value\. Expected /),
    ],
    [
      '/accounts/admin/usage?from=2026-01-01&limit=0',
      'to: Required; limit: Number must be greater than or equal to 1',
    ],
  ])('names the invalid parameters of %s', async (path, error) => {
    const response = await get(path)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
  })

  it('streams every page of the interactions as JSON and as CSV', async () => {
    mockPages(async function* () {
      yield [interaction('1'), interaction('2')]
      yield [interaction('3')]
    })
    const range = 'from=2026-11-01&to=2026-11-02'

    const json = await get(`/accounts/a/usage-report/interactions?${range}`)
    const csv = await get(
      `/accounts/a/usage-report/interactions?${range}&format=csv`,
    )

    expect(
      ((await json.json()) as UsageInteraction[]).map((i) => i.id),
    ).toEqual(['1', '2', '3'])
    expect(csv.headers.get('content-disposition')).toContain(
      'usage-a-2026-11-01-2026-11-02-interactions.csv',
    )
    const lines = (await csv.text()).split('\r\n')
    expect(lines[0]).toBe(
      'id,created_at,type,source,bytes,cid,api_key_id,api_key_name,ai3_value',
    )
    expect(lines.slice(1)).toEqual([
      '1,2026-11-01T00:00:00.000Z,upload,purchased,10,cid-1,,,0.00000000000000002',
      '2,2026-11-01T00:00:00.000Z,upload,purchased,10,cid-2,,,0.00000000000000002',
      '3,2026-11-01T00:00:00.000Z,upload,purchased,10,cid-3,,,0.00000000000000002',
      '',
    ])
  })

  it('finishes when the client has gone before the first write', async () => {
    // The response's 'close' has fired by the time the use case returns.
    const client = new AbortController()
    const closed = new Promise<void>((resolve) =>
      server.once('request', (_req, res) => res.once('close', resolve)),
    )
    let finished: () => void
    const handlerDone = new Promise<void>((resolve) => (finished = resolve))
    mockPages(
      async function* () {
        try {
          yield [interaction('1')]
        } finally {
          // The handler stops reading pages once it sees the client has gone.
          finished()
        }
      },
      async () => {
        client.abort()
        await closed
      },
    )

    await expect(
      get(
        '/accounts/a/usage-report/interactions?from=2026-11-01&to=2026-11-02',
        {
          signal: client.signal,
        },
      ),
    ).rejects.toThrow()
    await handlerDone
  })
})
