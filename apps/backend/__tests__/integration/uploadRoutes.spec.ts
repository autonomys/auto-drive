import { createServer } from 'net'
import { jest } from '@jest/globals'
import { UploadStatus } from '@auto-drive/models'
import { config } from '../../src/config.js'
import { AccountsUseCases } from '../../src/core/users/accounts.js'
import { UploadsUseCases } from '../../src/core/uploads/uploads.js'
import { uploadsRepository } from '../../src/infrastructure/repositories/uploads/uploads.js'
import { AuthManager } from '../../src/infrastructure/services/auth/index.js'
import { dbMigration } from '../utils/dbMigrate.js'
import { createMockUser, mockRabbitPublish } from '../utils/mocks.js'

// The use cases throw HttpErrors for client mistakes; these check that the REST
// routes answer them with their own status rather than a 500.
describe('Upload routes answer client errors with their own status', () => {
  const user = createMockUser()
  const userWithoutCredits = createMockUser()
  const portDefault = config.express.port
  let base: string

  // The API binds config.express.port at import, and another suite in the same
  // run may already hold the default.
  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const probe = createServer()
      probe.once('error', reject)
      probe.listen(0, () => {
        const address = probe.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('no port'))
          return
        }
        probe.close(() => resolve(address.port))
      })
    })

  const authHeaders = (token = 'token') => ({
    Authorization: `Bearer ${token}`,
    'X-Auth-Provider': user.oauthProvider,
  })

  const postChunk = (
    uploadId: string,
    index: number,
    data: Buffer,
    token?: string,
  ) => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(data)]))
    form.append('index', String(index))
    return fetch(`${base}/uploads/file/${uploadId}/chunk`, {
      method: 'POST',
      headers: authHeaders(token),
      body: form,
    })
  }

  const postComplete = (uploadId: string, token?: string) =>
    fetch(`${base}/uploads/${uploadId}/complete`, {
      method: 'POST',
      headers: authHeaders(token),
    })

  const createUpload = (owner = user) =>
    UploadsUseCases.createFileUpload(owner, 'file.bin', null, null)

  beforeAll(async () => {
    await dbMigration.up()
    await AccountsUseCases.initAccount(userWithoutCredits.organizationId!, 0, 0)

    const port = await freePort()
    config.express.port = port
    base = `http://localhost:${port}`

    await import('../../src/app/apis/frontend.js')

    const deadline = Date.now() + 15_000
    for (;;) {
      try {
        const health = await fetch(`${base}/health`)
        if (health.status === 204) {
          break
        }
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        throw new Error('frontend API did not start')
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })

  afterAll(async () => {
    config.express.port = portDefault
    await dbMigration.down()
  })

  beforeEach(() => {
    mockRabbitPublish()
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockImplementation(async (_provider, token) =>
        token === 'no-credits' ? userWithoutCredits : user,
      )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('POST /uploads/file/:uploadId/chunk', () => {
    it('answers 400 when a processed part is replaced with different content', async () => {
      const upload = await createUpload()
      expect((await postChunk(upload.id, 0, Buffer.from('first'))).status).toBe(
        200,
      )

      const response = await postChunk(upload.id, 0, Buffer.from('second'))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Cannot replace already-processed part 0 with different content',
      })
    })
  })

  describe('POST /uploads/:uploadId/complete', () => {
    it('answers 400 when a part is missing', async () => {
      const upload = await createUpload()
      expect(
        (await postChunk(upload.id, 1, Buffer.from('second'))).status,
      ).toBe(200)

      const response = await postComplete(upload.id)
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/gap in sequence/)
    })

    it('answers 400 when the upload has failed', async () => {
      const upload = await createUpload()
      await uploadsRepository.updateUploadStatusByRootUploadId(
        upload.id,
        UploadStatus.FAILED,
      )

      const response = await postComplete(upload.id)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: `Upload ${upload.id} is failed`,
      })
    })

    it('answers 409 while another completion holds the claim', async () => {
      const upload = await createUpload()
      expect(
        await uploadsRepository.claimUploadForCompletion(
          upload.id,
          config.uploads.completionClaimStaleMs,
        ),
      ).toBe(true)

      const response = await postComplete(upload.id)
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({
        error: `Upload ${upload.id} is already being completed; retry once it finishes`,
      })
    })

    it('answers 402 when the account cannot pay for the upload', async () => {
      const upload = await createUpload(userWithoutCredits)
      expect(
        (await postChunk(upload.id, 0, Buffer.from('data'), 'no-credits'))
          .status,
      ).toBe(200)

      const response = await postComplete(upload.id, 'no-credits')
      expect({
        status: response.status,
        body: await response.json(),
      }).toEqual({
        status: 402,
        body: { error: 'Not enough upload credits' },
      })
    })
  })
})
