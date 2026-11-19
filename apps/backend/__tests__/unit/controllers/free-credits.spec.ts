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
import { AdminFreeCredit, UserRole } from '@auto-drive/models'
import { accountController } from '../../../src/app/controllers/accounts.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { createMockUser } from '../../utils/mocks.js'

// The free credit routes over HTTP: body validation and serialisation. The
// grants themselves are tested on the use cases (e2e/users/partnerFreeCredits).
describe('Free credit routes', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    const app = express()
    app.use(express.json())
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

  const request = (path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: 'Bearer token',
        'x-auth-provider': 'apikey',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  const credit: AdminFreeCredit = {
    id: '00000000-0000-4000-8000-000000000001',
    accountId: 'acc',
    intentId: null,
    kind: 'free_one_time',
    grantPeriod: null,
    uploadBytesOriginal: 5n,
    uploadBytesRemaining: 5n,
    downloadBytesOriginal: 0n,
    downloadBytesRemaining: 0n,
    purchasedAt: new Date('2026-11-01T00:00:00Z'),
    expiresAt: new Date('2026-12-01T00:00:00Z'),
    expired: false,
    refundedAt: null,
    refundTxHash: null,
    refundedUploadBytes: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    grantedBy: 'admin-pub',
    grantReason: 'Pilot',
  }

  it.each([
    [{}, 'uploadBytes: Required; reason: Required'],
    [
      { uploadBytes: 1.5, expiresInDays: 0, reason: '  ' },
      'uploadBytes: Expected integer, received float; ' +
        'expiresInDays: Number must be greater than or equal to 1; ' +
        'reason: String must contain at least 1 character(s)',
    ],
    [
      { uploadBytes: 2 ** 53, expiresInDays: 36501, reason: 'x' },
      'uploadBytes: Number must be less than or equal to 9007199254740991; ' +
        'expiresInDays: Number must be less than or equal to 36500',
    ],
  ])('names the invalid parameters of %j', async (body, error) => {
    const grant = jest.spyOn(AccountsUseCases, 'grantFreeCredits')

    const response = await request('/accounts/admin/acc/free-credits', body)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
    expect(grant).not.toHaveBeenCalled()
  })

  it('grants with a trimmed reason and answers 201 with the batch', async () => {
    const grant = jest
      .spyOn(AccountsUseCases, 'grantFreeCredits')
      .mockResolvedValue(ok(credit))

    const response = await request('/accounts/admin/acc/free-credits', {
      uploadBytes: 5,
      reason: ' Pilot ',
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      id: credit.id,
      kind: 'free_one_time',
      uploadBytesOriginal: '5',
      grantedBy: 'admin-pub',
      grantReason: 'Pilot',
    })
    expect(grant).toHaveBeenCalledWith(expect.anything(), 'acc', {
      uploadBytes: 5,
      reason: 'Pilot',
    })
  })

  it('lists the free credits rather than the account', async () => {
    const list = jest
      .spyOn(AccountsUseCases, 'adminGetFreeCredits')
      .mockResolvedValue(ok([credit]))
    const account = jest.spyOn(AccountsUseCases, 'adminGetAccount')

    const response = await request('/accounts/admin/acc/free-credits')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      expect.objectContaining({ id: credit.id, uploadBytesRemaining: '5' }),
    ])
    expect(list).toHaveBeenCalledWith(expect.anything(), 'acc')
    expect(account).not.toHaveBeenCalled()
  })
})
