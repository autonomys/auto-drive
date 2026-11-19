import { createServer } from 'net'
import { jest } from '@jest/globals'
import { config } from '../../src/config.js'
import {
  AuthLookupError,
  AuthManager,
} from '../../src/infrastructure/services/auth/index.js'
import { dbMigration } from '../utils/dbMigrate.js'
import { createMockUser } from '../utils/mocks.js'

describe('JSON and URL-encoded request bodies', () => {
  const user = createMockUser()
  const portDefault = config.express.port
  let frontend: string
  let download: string

  // The APIs bind config.express.port at import, and another suite in the same
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

  const start = async (api: string) => {
    config.express.port = await freePort()
    const base = `http://localhost:${config.express.port}`
    await import(api)
    const deadline = Date.now() + 15_000
    for (;;) {
      try {
        if ((await fetch(`${base}/health`)).status === 204) {
          return base
        }
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        throw new Error(`${api} did not start`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  const post = (url: string, body: string, token = 'token') =>
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Auth-Provider': user.oauthProvider,
        'Content-Type': 'application/json',
      },
      body,
    })

  // A JSON document of exactly `bytes` bytes.
  const jsonOfSize = (bytes: number) =>
    JSON.stringify({ x: 'x'.repeat(bytes - '{"x":""}'.length) })

  beforeAll(async () => {
    await dbMigration.up()
    frontend = await start('../../src/app/apis/frontend.js')
    download = await start('../../src/app/apis/download.js')
  }, 30_000)

  afterAll(async () => {
    config.express.port = portDefault
    await dbMigration.down()
  })

  beforeEach(() => {
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockImplementation(async (_provider, token) => {
        if (token === 'rejected') {
          throw new AuthLookupError('rejected', true, 401)
        }
        return user
      })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // 100 KB is body-parser's default limit. A body at the limit reaches the
  // route: 401 for the rejected token, 400 for the missing filename.
  it.each([
    ['/organizations/partners', 'rejected', 401],
    ['/uploads/file', 'token', 400],
  ])(
    '%s answers 413 for a JSON body over 100 KB',
    async (path, token, statusAtLimit) => {
      const url = `${frontend}${path}`
      const limit = 100 * 1024
      const atLimit = await post(url, jsonOfSize(limit), token)
      expect(atLimit.status).toBe(statusAtLimit)
      expect((await post(url, jsonOfSize(limit + 1), token)).status).toBe(413)
    },
  )

  it.each([
    '/uploads/file',
    '/uploads/folder',
    '/uploads/folder/some-id/file',
    '/uploads/file/some-id/chunk',
  ])(
    '%s answers 401 to a rejected credential without reading the body',
    async (path) => {
      const response = await post(`${frontend}${path}`, '{not json', 'rejected')
      expect(response.status).toBe(401)
    },
  )

  it('/uploads/file/:uploadId/chunk answers a JSON body as a missing chunk', async () => {
    const response = await post(`${frontend}/uploads/file/some-id/chunk`, '{}')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Missing chunk: expected formData entry in field `file`',
    })
  })

  it('/downloads/async/:cid answers 401 to a rejected credential without reading the body', async () => {
    const response = await post(
      `${download}/downloads/async/some-cid`,
      '{not json',
      'rejected',
    )
    expect(response.status).toBe(401)
  })

  // The SDK sends one entry per file, with the file's path as its id
  // (constructFromFileSystemEntries in @autonomys/auto-drive), so the tree
  // grows by 34 bytes plus the name and path of each file.
  it('accepts a folder tree of 20,000 files (about 2 MB)', async () => {
    const children = Array.from({ length: 20_000 }, (_, i) => ({
      name: `file-${i}.js`,
      type: 'file',
      id: `project/node_modules/package-${i % 500}/dist/esm/file-${i}.js`,
    }))
    const body = JSON.stringify({
      fileTree: { name: 'project', type: 'folder', id: 'project', children },
      uploadOptions: null,
    })
    expect(body.length).toBeGreaterThan(2_000_000)

    const response = await post(`${frontend}/uploads/folder`, body)
    expect(response.status).toBe(200)
    expect((await response.json()).fileTree.children).toHaveLength(20_000)
  })
})
