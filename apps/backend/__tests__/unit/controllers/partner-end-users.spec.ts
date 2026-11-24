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
import { Express, Request, Response } from 'express'
import { AddressInfo } from 'net'
import { Server } from 'http'
import { Readable } from 'stream'
import { ok } from 'neverthrow'
import { v4 } from 'uuid'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import {
  AsyncDownload,
  AsyncDownloadStatus,
  OrganizationRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { createFrontendApp } from '../../../src/app/apis/frontendApp.js'
import { createDownloadApp } from '../../../src/app/apis/downloadApp.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import {
  allowPartnerEndUsers,
  tryAuthenticate,
} from '../../../src/infrastructure/services/auth/express.js'
import {
  metadataRepository,
  ownershipRepository,
} from '../../../src/infrastructure/repositories/index.js'
import { asyncDownloadsRepository } from '../../../src/infrastructure/repositories/asyncDownloads/index.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { ObjectUseCases } from '../../../src/core/index.js'
import {
  AsyncDownloadsUseCases,
  DownloadUseCase,
} from '../../../src/core/downloads/index.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { createMockUser } from '../../utils/mocks.js'

type Layer = {
  route?: { path: string; methods: Record<string, boolean> }
  handle: { stack?: Layer[] }
  regexp: RegExp
}

// Every route of an Express 4 app as 'METHOD /path', the routers mounted in it
// included.
const routesOf = (stack: Layer[], prefix = ''): string[] =>
  stack.flatMap((layer) => {
    if (layer.route) {
      const { path, methods } = layer.route
      return Object.keys(methods).map(
        (method) => `${method.toUpperCase()} ${prefix}${path}`,
      )
    }
    if (!layer.handle.stack) return []
    // What app.use('/a/b', router) compiles to.
    const mount = /^\^((?:\\\/[\w-]+)*)\\\/\?\(\?=\\\/\|\$\)$/.exec(
      layer.regexp.source,
    )
    if (!mount) throw new Error(`Unexpected mount: ${layer.regexp}`)
    return routesOf(layer.handle.stack, prefix + mount[1].replace(/\\/g, ''))
  })

// The routes partner end users may use. Opening another route to them means
// adding it here.
const UPLOADS = [
  'POST /uploads/file',
  'POST /uploads/folder',
  'POST /uploads/folder/:uploadId/file',
  'POST /uploads/file/:uploadId/chunk',
  'POST /uploads/:uploadId/complete',
]
// Removed end users keep these.
const OWN_FILES = [
  'GET /objects/roots',
  'GET /objects/roots/deleted',
  'GET /objects/:cid/summary',
  'POST /objects/:cid/delete',
  'POST /objects/:cid/restore',
  'GET /objects/:cid',
  'GET /downloads/:cid',
  'POST /downloads/async/:cid',
  'POST /downloads/async/:downloadId/dismiss',
  'GET /downloads/async/@me',
  'GET /downloads/async/:downloadId',
]
// Routes that need no credential. Only GET /features/ reads one, where an end
// user's counts as none (tryAuthenticate).
const PUBLIC = [
  'GET /health',
  'GET /features/',
  'GET /docs/',
  'GET /docs/raw',
  'GET /intents/price',
  'GET /intents/contract',
  'GET /objects/:cid/metadata',
  'GET /objects/:cid/status',
  'GET /objects/:id/public',
  'POST /objects/:cid/report',
  'GET /downloads/:cid/status',
]
// The S3 API answers every object path from one middleware, not a route.
const S3_OBJECT_ROUTES = ['GET /s3/bucket/key', 'PUT /s3/bucket/key']

const REFUSALS = [
  'Not available to partner end users',
  'Not available to removed partner end users',
]

const fileMetadata = (cid: string): OffchainMetadata => ({
  type: 'file',
  dataCid: cid,
  name: `${cid}.txt`,
  totalSize: 2n,
  totalChunks: 1,
  chunks: [],
})

describe('Partner end users', () => {
  const servers: Server[] = []
  let frontend: { app: Express; url: string }
  let download: { app: Express; url: string }
  let caller: UserWithOrganization

  const endUser: UserWithOrganization = {
    ...createMockUser(),
    oauthProvider: 'web3-wallet',
    organizationRole: OrganizationRole.PartnerEndUser,
    customerReference: 'customer-1',
    uploadQuotaBytes: null,
    endUserRemovedAt: null,
  }
  const removedEndUser = {
    ...endUser,
    endUserRemovedAt: '2026-11-24T00:00:00.000Z',
  }
  const member: UserWithOrganization = {
    ...createMockUser(),
    organizationRole: OrganizationRole.Member,
  }

  // The end user's file, and a folder with a file in it; another user's file.
  const ownCid = `own-${v4()}`
  const folderCid = `folder-${v4()}`
  const childCid = `child-${v4()}`
  const otherCid = `other-${v4()}`

  const listen = async (app: Express) => {
    const server = app.listen(0)
    servers.push(server)
    await new Promise((resolve) => server.once('listening', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  beforeAll(async () => {
    await dbMigration.up()

    const frontendApp = createFrontendApp()
    const downloadApp = createDownloadApp()
    frontend = { app: frontendApp, url: await listen(frontendApp) }
    download = { app: downloadApp, url: await listen(downloadApp) }

    await metadataRepository.setMetadata(ownCid, ownCid, fileMetadata(ownCid))
    await ownershipRepository.setUserAsAdmin(
      ownCid,
      endUser.oauthProvider,
      endUser.oauthUserId,
    )
    await metadataRepository.setMetadata(folderCid, folderCid, {
      type: 'folder',
      dataCid: folderCid,
      name: 'folder',
      totalSize: 2n,
      totalFiles: 1,
      children: [],
      uploadOptions: {},
    })
    await metadataRepository.setMetadata(
      folderCid,
      childCid,
      fileMetadata(childCid),
    )
    await ownershipRepository.setUserAsAdmin(
      folderCid,
      endUser.oauthProvider,
      endUser.oauthUserId,
    )
    await metadataRepository.setMetadata(
      otherCid,
      otherCid,
      fileMetadata(otherCid),
    )
    await ownershipRepository.setUserAsAdmin(
      otherCid,
      member.oauthProvider,
      member.oauthUserId,
    )
  })

  afterAll(async () => {
    await Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(resolve))),
    )
    await dbMigration.down()
  })

  beforeEach(() => {
    caller = endUser
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockImplementation(async () => caller)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const headers = {
    authorization: 'Bearer token',
    'x-auth-provider': 'custom-jwt',
  }
  // S3 reads the access key from a SigV4 header.
  const s3Headers = {
    authorization:
      'AWS4-HMAC-SHA256 Credential=key/20261124/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=0',
  }

  const send = (
    url: string,
    method = 'GET',
    body?: unknown,
    s3 = false,
  ): Promise<globalThis.Response> =>
    fetch(url, {
      method,
      headers: {
        ...(s3 ? s3Headers : headers),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  // Whether the default-deny gate refused the request.
  const refused = async (response: globalThis.Response) => {
    const text = await response.text()
    return (
      response.status === 403 &&
      REFUSALS.some((refusal) =>
        text.includes(text.startsWith('<') ? `>${refusal}<` : `"${refusal}"`),
      )
    )
  }

  describe('route walk', () => {
    const routes = () => [
      ...routesOf(frontend.app._router.stack).map(
        (route) => [frontend.url, route] as const,
      ),
      ...[...routesOf(download.app._router.stack), ...S3_OBJECT_ROUTES].map(
        (route) => [download.url, route] as const,
      ),
    ]

    it('names only routes that exist', () => {
      const all = routes().map(([, route]) => route)
      expect(all).toEqual(
        expect.arrayContaining([...UPLOADS, ...OWN_FILES, ...PUBLIC]),
      )
    })

    it.each([
      ['an end user', endUser, [...UPLOADS, ...OWN_FILES]],
      ['a removed end user', removedEndUser, OWN_FILES],
    ])(
      'refuses %s on every route but the ones open to them',
      async (_, user, open) => {
        caller = user
        const walked = routes().filter(([, route]) => !PUBLIC.includes(route))

        const results: [string, boolean][] = []
        for (const [base, route] of walked) {
          const [method, path] = route.split(' ')
          // A UUID suits every parameter of the routes that are open.
          const url = base + path.replace(/:\w+(\([^)]*\))?/g, v4())
          const response = await send(
            url,
            method,
            method === 'GET' ? undefined : {},
            path.startsWith('/s3'),
          )
          results.push([route, await refused(response)])
        }

        expect(results).toEqual(
          walked.map(([, route]) => [route, !open.includes(route)]),
        )
      },
    )

    it('says why a removed end user is refused uploads', async () => {
      caller = removedEndUser
      const response = await send(`${frontend.url}/uploads/file`, 'POST', {
        filename: 'a.txt',
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'Not available to removed partner end users',
      })
    })

    it('treats an end user as no credential on a route that does not let them in', async () => {
      const req = { headers } as unknown as Request
      expect(await tryAuthenticate(req)).toBeNull()

      allowPartnerEndUsers()(req, {} as Response, () => {})
      expect(await tryAuthenticate(req)).toBe(endUser)

      caller = removedEndUser
      expect(await tryAuthenticate(req)).toBeNull()
      allowPartnerEndUsers({ removed: true })(req, {} as Response, () => {})
      expect(await tryAuthenticate(req)).toBe(removedEndUser)
    })
  })

  describe('ownership', () => {
    const roots = async (query = '') => {
      const response = await send(`${frontend.url}/objects/roots${query}`)
      expect(response.status).toBe(200)
      const { rows } = (await response.json()) as {
        rows: { headCid: string }[]
      }
      return rows.map((row) => row.headCid).sort()
    }

    it('lists only their own objects, whatever the scope asked for', async () => {
      for (const user of [endUser, removedEndUser]) {
        caller = user
        for (const query of ['', '?scope=global', '?scope=user']) {
          expect(await roots(query)).toEqual([folderCid, ownCid].sort())
        }
      }
    })

    it('still lists every object for a member who asks for the global scope', async () => {
      caller = member
      const getRootObjects = jest.spyOn(ObjectUseCases, 'getRootObjects')

      await roots()

      expect(getRootObjects).toHaveBeenCalledWith(
        { scope: 'global' },
        undefined,
        undefined,
      )
    })

    it('refuses them on objects they do not own', async () => {
      const downloadObject = jest.spyOn(DownloadUseCase, 'downloadObjectByUser')
      const createDownload = jest.spyOn(
        AsyncDownloadsUseCases,
        'createDownload',
      )

      for (const user of [endUser, removedEndUser]) {
        caller = user
        for (const [url, method] of [
          [`${download.url}/downloads/${otherCid}`, 'GET'],
          [`${download.url}/downloads/async/${otherCid}`, 'POST'],
          [`${frontend.url}/objects/${otherCid}/delete`, 'POST'],
          [`${frontend.url}/objects/${otherCid}/restore`, 'POST'],
        ]) {
          const response = await send(url, method)
          expect([url, response.status]).toEqual([url, 403])
        }
      }

      expect(downloadObject).not.toHaveBeenCalled()
      expect(createDownload).not.toHaveBeenCalled()
    })

    it('answers the details of an object they do not own as for anyone', async () => {
      for (const path of [
        `/objects/${otherCid}`,
        `/objects/${otherCid}/summary`,
      ]) {
        const response = await send(`${frontend.url}${path}`)
        expect(response.status).toBe(200)
        expect(
          ((await response.json()) as { owners: unknown[] }).owners,
        ).toEqual([])
      }
    })

    it('lets them, removed or not, look up, download, remove and restore their own', async () => {
      const downloadObject = jest
        .spyOn(DownloadUseCase, 'downloadObjectByUser')
        .mockImplementation(async () =>
          ok({
            metadata: {
              type: 'file',
              name: 'own.txt',
              size: 2n,
              isEncrypted: false,
              isCompressed: false,
            },
            startDownload: () => Readable.from([Buffer.from('hi')]),
          }),
        )
      jest
        .spyOn(AsyncDownloadsUseCases, 'createDownload')
        .mockResolvedValue(ok({ id: 'download' } as AsyncDownload))

      for (const user of [endUser, removedEndUser]) {
        caller = user

        const details = await send(`${frontend.url}/objects/${ownCid}`)
        expect(
          ((await details.json()) as { owners: unknown[] }).owners,
        ).toEqual([
          {
            oauthProvider: endUser.oauthProvider,
            oauthUserId: endUser.oauthUserId,
            role: 'admin',
          },
        ])

        // A file in a folder they own is theirs too.
        for (const cid of [ownCid, childCid]) {
          const response = await send(`${download.url}/downloads/${cid}`)
          expect([cid, response.status]).toEqual([cid, 200])
          expect(await response.text()).toBe('hi')
        }
        const asyncDownload = await send(
          `${download.url}/downloads/async/${ownCid}`,
          'POST',
        )
        expect(asyncDownload.status).toBe(200)

        const remove = await send(
          `${frontend.url}/objects/${ownCid}/delete`,
          'POST',
        )
        expect(remove.status).toBe(200)
        const deleted = await send(`${frontend.url}/objects/roots/deleted`)
        expect(
          ((await deleted.json()) as { rows: { headCid: string }[] }).rows.map(
            (row) => row.headCid,
          ),
        ).toEqual([ownCid])
        const restore = await send(
          `${frontend.url}/objects/${ownCid}/restore`,
          'POST',
        )
        expect(restore.status).toBe(200)
        expect(await roots()).toContain(ownCid)
      }

      expect(downloadObject).toHaveBeenCalledTimes(8)
    })

    it('refuses them on async downloads they did not create', async () => {
      const downloadId = v4()
      await asyncDownloadsRepository.createDownload(
        downloadId,
        member.oauthProvider,
        member.oauthUserId,
        otherCid,
        AsyncDownloadStatus.Pending,
        2n,
      )

      for (const user of [endUser, removedEndUser]) {
        caller = user
        const get = await send(`${download.url}/downloads/async/${downloadId}`)
        expect(get.status).toBe(403)
        const dismiss = await send(
          `${download.url}/downloads/async/${downloadId}/dismiss`,
          'POST',
        )
        expect(dismiss.status).toBe(403)
      }
      expect(
        (await asyncDownloadsRepository.getDownloadById(downloadId))?.status,
      ).toBe(AsyncDownloadStatus.Pending)
    })

    it('refuses them on uploads they did not create', async () => {
      const folder = await UploadsUseCases.createFolderUpload(
        member,
        'folder',
        { type: 'folder', name: 'folder', id: 'root', children: [] },
        null,
      )
      const file = await UploadsUseCases.createFileUpload(
        member,
        'file.txt',
        'text/plain',
        null,
      )

      const fileInFolder = await send(
        `${frontend.url}/uploads/folder/${folder.id}/file`,
        'POST',
        { name: 'a.txt', relativeId: 'a', uploadOptions: null },
      )
      expect(fileInFolder.status).toBe(403)

      const form = new FormData()
      form.append('index', '0')
      form.append('file', new Blob(['hi']), 'chunk')
      const chunk = await fetch(
        `${frontend.url}/uploads/file/${file.id}/chunk`,
        { method: 'POST', headers, body: form },
      )
      expect(chunk.status).toBe(403)

      const complete = await send(
        `${frontend.url}/uploads/${file.id}/complete`,
        'POST',
      )
      expect(complete.status).toBe(403)
    })

    it('lets them upload into an upload of their own', async () => {
      const created = await send(`${frontend.url}/uploads/folder`, 'POST', {
        fileTree: { type: 'folder', name: 'mine', id: 'root', children: [] },
        uploadOptions: null,
      })
      expect(created.status).toBe(200)
      const { id } = (await created.json()) as { id: string }

      const fileInFolder = await send(
        `${frontend.url}/uploads/folder/${id}/file`,
        'POST',
        { name: 'a.txt', relativeId: 'a', uploadOptions: null },
      )
      expect(fileInFolder.status).toBe(200)
    })
  })
})
