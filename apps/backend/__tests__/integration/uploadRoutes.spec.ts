import { createServer } from 'net'
import { randomBytes } from 'crypto'
import { jest } from '@jest/globals'
import { UploadStatus, UserWithOrganization } from '@auto-drive/models'
import { config } from '../../src/config.js'
import { AccountsUseCases } from '../../src/core/users/accounts.js'
import { UploadsUseCases } from '../../src/core/uploads/uploads.js'
import { uploadsRepository } from '../../src/infrastructure/repositories/uploads/uploads.js'
import {
  AuthLookupError,
  AuthManager,
} from '../../src/infrastructure/services/auth/index.js'
import { getDatabase } from '../../src/infrastructure/drivers/pg.js'
import { dbMigration } from '../utils/dbMigrate.js'
import { createMockUser, mockRabbitPublish } from '../utils/mocks.js'

// The use cases throw HttpErrors for client mistakes; these check that the REST
// routes answer them with their own status rather than a 500.
describe('Upload routes answer client errors with their own status', () => {
  const user = createMockUser()
  const userWithoutCredits = createMockUser()
  const FEW_CREDITS = 4
  const userWithFewCredits = createMockUser()
  // What auth answers for an account that has not onboarded.
  const userNotOnboarded = {
    ...createMockUser(),
    onboarded: false,
    organizationId: null,
  } as unknown as UserWithOrganization
  const usersByToken: Record<string, UserWithOrganization> = {
    'no-credits': userWithoutCredits,
    'few-credits': userWithFewCredits,
    'not-onboarded': userNotOnboarded,
  }
  const portDefault = config.express.port
  const chunkLimitDefault = config.express.uploadChunkMaxBytes
  // Read when the API is imported below; small so the tests can exceed it.
  const CHUNK_LIMIT = 64 * 1024
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

  const postJson = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
    token?: string,
  ) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        ...authHeaders(token),
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
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
    await AccountsUseCases.initAccount(
      userWithFewCredits.organizationId!,
      FEW_CREDITS,
      0,
    )

    const port = await freePort()
    config.express.port = port
    config.express.uploadChunkMaxBytes = CHUNK_LIMIT
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
    config.express.uploadChunkMaxBytes = chunkLimitDefault
    await dbMigration.down()
  })

  beforeEach(() => {
    mockRabbitPublish()
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockImplementation(
        async (_provider, token) => usersByToken[token] ?? user,
      )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('name too long (400)', () => {
    const tooLongName = '€'.repeat(86)
    const tooLongError = {
      error: `Name "${tooLongName}" is too long: 258 > 255 bytes`,
    }

    it('POST /uploads/file', async () => {
      const accepted = await postJson('/uploads/file', {
        filename: '€'.repeat(85),
        mimeType: null,
        uploadOptions: null,
      })
      expect(accepted.status).toBe(200)

      const rejected = await postJson('/uploads/file', {
        filename: tooLongName,
        mimeType: null,
        uploadOptions: null,
      })
      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toEqual(tooLongError)
    })

    it('POST /uploads/folder', async () => {
      const response = await postJson('/uploads/folder', {
        fileTree: {
          name: 'folder',
          type: 'folder',
          id: 'folder',
          children: [{ name: tooLongName, type: 'file', id: 'file' }],
        },
        uploadOptions: null,
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(tooLongError)
    })

    it('POST /uploads/folder/:uploadId/file', async () => {
      const folderUpload = await UploadsUseCases.createFolderUpload(
        user,
        'folder',
        { name: 'folder', type: 'folder', id: 'folder', children: [] },
        null,
      )

      const response = await postJson(
        `/uploads/folder/${folderUpload.id}/file`,
        {
          name: tooLongName,
          mimeType: null,
          relativeId: 'file',
          uploadOptions: null,
        },
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(tooLongError)
    })
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

  describe('uploads the caller could not complete', () => {
    const partsStored = async (uploadId: string) => {
      const db = await getDatabase()
      const result = await db.query<{ count: string }>(
        'SELECT count(*) FROM uploads.file_parts WHERE upload_id = $1',
        [uploadId],
      )
      return Number(result.rows[0].count)
    }

    it('answers 402 for a part beyond twice the credits of the caller and stores nothing', async () => {
      const upload = await createUpload(userWithoutCredits)

      const response = await postChunk(
        upload.id,
        0,
        Buffer.from('data'),
        'no-credits',
      )
      expect({
        status: response.status,
        body: await response.json(),
      }).toEqual({
        status: 402,
        body: { error: 'Not enough upload credits' },
      })
      expect(await partsStored(upload.id)).toBe(0)
    })

    it.each([
      ['/uploads/file', { filename: 'file.bin' }],
      [
        '/uploads/folder',
        {
          fileTree: {
            name: 'folder',
            type: 'folder',
            id: 'folder',
            children: [],
          },
        },
      ],
    ])(
      'answers 403 to POST %s from a caller who is not onboarded',
      async (path, body) => {
        const response = await postJson(
          path,
          { ...body, mimeType: null, uploadOptions: null },
          {},
          'not-onboarded',
        )
        expect({
          status: response.status,
          body: await response.json(),
        }).toEqual({ status: 403, body: { error: 'User not onboarded' } })
      },
    )
  })

  describe('POST /uploads/file/:uploadId/chunk limits', () => {
    it('answers 413 for a part over the size limit and stores nothing', async () => {
      const upload = await createUpload()
      const uploadChunk = jest.spyOn(UploadsUseCases, 'uploadChunk')

      const response = await postChunk(
        upload.id,
        0,
        Buffer.alloc(CHUNK_LIMIT + 1),
      )
      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({
        error: `Chunk exceeds the ${CHUNK_LIMIT} byte limit`,
      })
      expect(uploadChunk).not.toHaveBeenCalled()
    })

    it('accepts a part of exactly the size limit', async () => {
      const upload = await createUpload()
      const response = await postChunk(upload.id, 0, Buffer.alloc(CHUNK_LIMIT))
      expect(response.status).toBe(200)
    })

    // An oversized part is only answered 413 once its body has been read, so
    // a 401 here shows the credentials were checked first.
    it('answers 401 before reading the body', async () => {
      jest
        .spyOn(AuthManager, 'getUserFromAccessToken')
        .mockRejectedValueOnce(new AuthLookupError('rejected', true, 401))
      const upload = await createUpload()

      const response = await postChunk(
        upload.id,
        0,
        Buffer.alloc(CHUNK_LIMIT + 1),
      )
      expect(response.status).toBe(401)
    })

    it.each([
      ['without a boundary', 'multipart/form-data', 'x'],
      [
        'cut off mid-part',
        'multipart/form-data; boundary=b',
        '--b\r\nContent-Disposition: form-data; name="file"; filename="f"\r\n\r\nabc',
      ],
    ])('answers 400 for a form %s', async (_case, contentType, body) => {
      const upload = await createUpload()
      const response = await fetch(`${base}/uploads/file/${upload.id}/chunk`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': contentType },
        body,
      })
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/^Invalid chunk form: /)
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

    // A part is stored while the caller's unfinished bytes stay within twice
    // their credits; whether the upload is paid for is decided here.
    it('answers 402 when the account cannot pay for the upload', async () => {
      const upload = await createUpload(userWithFewCredits)
      expect(
        (
          await postChunk(
            upload.id,
            0,
            Buffer.alloc(FEW_CREDITS + 1),
            'few-credits',
          )
        ).status,
      ).toBe(200)

      const response = await postComplete(upload.id, 'few-credits')
      expect({
        status: response.status,
        body: await response.json(),
      }).toEqual({
        status: 402,
        body: { error: 'Not enough upload credits' },
      })
    })
  })

  // #892: the caller's reference for the customer an upload is for.
  describe('X-Customer-Reference', () => {
    const referenced = (reference: string) => ({
      'X-Customer-Reference': reference,
    })

    const folderTree = {
      name: 'folder',
      type: 'folder',
      id: 'folder',
      children: [{ name: 'file', type: 'file', id: 'file' }],
    }

    // Uploads one part and completes the upload; resolves to the references
    // on the interactions it was charged as.
    const completeAndReadReferences = async (uploadId: string) => {
      expect((await postChunk(uploadId, 0, randomBytes(64))).status).toBe(200)
      const completed = await postComplete(uploadId)
      expect(completed.status).toBe(200)
      const { cid } = await completed.json()

      const db = await getDatabase()
      const result = await db.query<{ customer_reference: string | null }>(
        'SELECT customer_reference FROM interactions WHERE cid = $1',
        [cid],
      )
      return result.rows.map((r) => r.customer_reference)
    }

    const fileUpload = { filename: 'file.bin', uploadOptions: null }

    it('is recorded on the interactions of a file upload', async () => {
      const created = await postJson(
        '/uploads/file',
        fileUpload,
        referenced('cust_1.a:b-2'),
      )
      expect(created.status).toBe(200)

      expect(await completeAndReadReferences((await created.json()).id)).toEqual(
        ['cust_1.a:b-2'],
      )
    })

    it('is NULL when the upload is created without one', async () => {
      const created = await postJson('/uploads/file', fileUpload)
      expect(created.status).toBe(200)

      expect(await completeAndReadReferences((await created.json()).id)).toEqual(
        [null],
      )
    })

    it('set on a folder upload is recorded for its files', async () => {
      const folder = await postJson(
        '/uploads/folder',
        { fileTree: folderTree, uploadOptions: null },
        referenced('cust-folder'),
      )
      expect(folder.status).toBe(200)
      const folderId = (await folder.json()).id
      const fileInFolder = {
        name: 'file',
        mimeType: null,
        relativeId: 'file',
        uploadOptions: null,
      }

      const different = await postJson(
        `/uploads/folder/${folderId}/file`,
        fileInFolder,
        referenced('cust-other'),
      )
      expect({
        status: different.status,
        body: await different.json(),
      }).toEqual({
        status: 400,
        body: {
          error:
            'A file in a folder upload takes the customer reference of the folder upload',
        },
      })

      for (const headers of [{}, referenced('cust-folder')]) {
        const file = await postJson(
          `/uploads/folder/${folderId}/file`,
          fileInFolder,
          headers,
        )
        expect(file.status).toBe(200)
        expect(
          await completeAndReadReferences((await file.json()).id),
        ).toEqual(['cust-folder'])
      }
    })

    it.each([
      ['empty', ''],
      ['too long', 'a'.repeat(129)],
      ['with a space', 'cust 1'],
      ['with a slash', 'cust/1'],
      ['repeated', ['cust-1', 'cust-2']],
    ])('answers 400 when it is %s', async (_case, value) => {
      const headers = new Headers(authHeaders())
      headers.set('Content-Type', 'application/json')
      for (const v of [value].flat()) headers.append('X-Customer-Reference', v)

      for (const [path, body] of [
        ['/uploads/file', fileUpload],
        ['/uploads/folder', { fileTree: folderTree, uploadOptions: null }],
      ] as const) {
        const response = await fetch(`${base}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
        expect({
          path,
          status: response.status,
          body: await response.json(),
        }).toEqual({
          path,
          status: 400,
          body: {
            error:
              'Invalid customer reference: use 1 to 128 letters, digits, "-", "_", "." or ":"',
          },
        })
      }
    })

    it('accepts 128 characters', async () => {
      const created = await postJson(
        '/uploads/file',
        fileUpload,
        referenced('a'.repeat(128)),
      )
      expect(created.status).toBe(200)
    })
  })
})
