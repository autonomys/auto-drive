import express from 'express'
import { Server } from 'http'
import { AddressInfo } from 'net'
import { jest } from '@jest/globals'
import { AsyncDownloadStatus, UserRole } from '@auto-drive/models'
import { v4 } from 'uuid'
import { accountController } from '../../src/app/controllers/accounts.js'
import { downloadController } from '../../src/app/controllers/download.js'
import { objectController } from '../../src/app/controllers/object.js'
import { asyncDownloadsRepository } from '../../src/infrastructure/repositories/asyncDownloads/index.js'
import { ownershipRepository } from '../../src/infrastructure/repositories/index.js'
import { AuthManager } from '../../src/infrastructure/services/auth/index.js'
import { dbMigration } from '../utils/dbMigrate.js'
import { createMockUser } from '../utils/mocks.js'
import { uploadFile } from '../utils/uploads.js'

// Each of these routes calls a use case that returns a Result. Passed on
// unopened, the Result's error is answered 200.
describe('Routes answer a use case error with its own status', () => {
  const owner = createMockUser()
  const stranger = createMockUser()
  const admin = { ...createMockUser(), role: UserRole.Admin }
  const users = { owner, stranger, admin }
  type Caller = keyof typeof users
  const downloadId = v4()
  let server: Server
  let base: string
  let cid: string

  const send = (
    method: 'GET' | 'POST',
    path: string,
    caller: Caller,
    body?: unknown,
  ) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${caller}`,
        'X-Auth-Provider': owner.oauthProvider,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

  beforeAll(async () => {
    await dbMigration.up()
    cid = await uploadFile(owner, 'file.txt', 'content', 'text/plain')
    await asyncDownloadsRepository.createDownload(
      downloadId,
      owner.oauthProvider,
      owner.oauthUserId,
      cid,
      AsyncDownloadStatus.Pending,
      7n,
    )

    const app = express()
    app.use(express.json())
    app.use('/downloads', downloadController)
    app.use('/objects', objectController)
    app.use('/accounts', accountController)
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await dbMigration.down()
  })

  beforeEach(() => {
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockImplementation(async (_provider, token) => users[token as Caller])
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each<[number, string, () => Promise<Response>]>([
    [
      404,
      'dismissing a download that does not exist',
      () => send('POST', '/downloads/async/missing/dismiss', 'owner'),
    ],
    [
      403,
      'dismissing the download of another user',
      () => send('POST', `/downloads/async/${downloadId}/dismiss`, 'stranger'),
    ],
    [
      403,
      'deleting the object of another user',
      () => send('POST', `/objects/${cid}/delete`, 'stranger'),
    ],
    [
      403,
      'restoring the object of another user',
      () => send('POST', `/objects/${cid}/restore`, 'stranger'),
    ],
    [
      403,
      'sharing the object of another user',
      () =>
        send('POST', `/objects/${cid}/share`, 'stranger', {
          publicId: stranger.publicId,
        }),
    ],
    [
      403,
      'reading the account ranking without being an admin',
      () => send('GET', '/accounts/ranking', 'stranger'),
    ],
  ])('answers %d to %s', async (status, _attempt, request) => {
    expect((await request()).status).toBe(status)
  })

  it('answers 200 to an owner repeating a delete or a restore', async () => {
    const removedAtAfter = async (action: 'delete' | 'restore') => {
      const response = await send('POST', `/objects/${cid}/${action}`, 'owner')
      expect(response.status).toBe(200)
      const [ownership] = await ownershipRepository.getAllOwnerships(cid)
      return ownership.marked_as_deleted
    }

    const removedAt = await removedAtAfter('delete')
    expect(removedAt).not.toBeNull()
    expect(await removedAtAfter('delete')).toEqual(removedAt)
    expect(await removedAtAfter('restore')).toBeNull()
    expect(await removedAtAfter('restore')).toBeNull()
  })

  it('answers a dismissal with the dismissed download', async () => {
    const response = await send(
      'POST',
      `/downloads/async/${downloadId}/dismiss`,
      'owner',
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: downloadId,
      status: AsyncDownloadStatus.Dismissed,
    })
  })

  it('answers an admin with the account ranking as a list', async () => {
    const response = await send('GET', '/accounts/ranking', 'admin')
    expect(response.status).toBe(200)
    expect(Array.isArray(await response.json())).toBe(true)
  })
})
