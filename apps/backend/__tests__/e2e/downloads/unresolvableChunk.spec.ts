import { jest } from '@jest/globals'
import { v4 } from 'uuid'
import { randomBytes } from 'crypto'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { AccountsUseCases } from '../../../src/core/index.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import express from 'express'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { downloadController } from '../../../src/app/controllers/download.js'
import { objectController } from '../../../src/app/controllers/object.js'
import { downloadService } from '../../../src/infrastructure/services/download/index.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'

jest.setTimeout(120_000)

/**
 * Issue #815, acceptance criterion 2 — a failure must arrive as a status a
 * client can read, not as a committed response that dies.
 *
 * The S3 handler is covered in the s3-sdk suite; this covers the REST download
 * path, which had the same shape (headers staged before the stream was known to
 * be servable) and the same fix.
 */
describe('download HTTP errors', () => {
  const user = createMockUser()
  let server: Server
  let BASE: string

  beforeAll(async () => {
    await dbMigration.up()
    // Just the controller on an ephemeral port. Booting the whole download API
    // would race the s3-sdk suite for config.express.port.
    const app = express()
    app.use('/downloads', downloadController)
    app.use('/objects', objectController)
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s))
    })
    BASE = `http://localhost:${(server.address() as AddressInfo).port}`
    mockRabbitPublish()
    await AccountsUseCases.getOrCreateAccount(user)
  })
  beforeEach(() => {
    jest.spyOn(AuthManager, 'getUserFromAccessToken').mockResolvedValue(user)
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(user)
  })
  afterEach(() => {
    jest.restoreAllMocks()
    mockRabbitPublish()
  })
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await dbMigration.down()
    unmockMethods()
    jest.clearAllMocks()
  })

  it.each(['authenticated', 'public'])(
    '%s download answers a safe, retryable 503 before committing file headers',
    async (route) => {
      const created = await UploadsUseCases.createFileUpload(
        user,
        `unresolvable-${v4()}.bin`,
        'application/octet-stream',
        null,
      )
      // Multi-chunk, so this exercises the batch resolution rather than the
      // single-chunk shortcut.
      await UploadsUseCases.uploadChunk(
        user,
        created.id,
        0,
        randomBytes(256 * 1024),
      )
      const cid = await UploadsUseCases.completeUpload(user, created.id)

      const metadata = await ObjectUseCases.getMetadata(cid)
      if (metadata.isErr()) throw new Error('no metadata')
      const value = metadata.value
      if (value.type !== 'file') throw new Error('not a file')
      expect(value.chunks.length).toBeGreaterThan(1)

      // Migration has not run (the queue is mocked), so the blockstore is the only
      // copy of this chunk. Removing it makes the CID resolvable from neither
      // table — what a genuinely unservable object looks like once the read race
      // is closed.
      const doomed = value.chunks[value.chunks.length - 1].cid
      const db = await getDatabase()
      const deleted = await db.query(
        'DELETE FROM uploads.blockstore WHERE cid = $1',
        [doomed],
      )
      expect(deleted.rowCount).toBeGreaterThan(0)

      const published = await ObjectUseCases.publishObject(user, cid)
      const path =
        route === 'public'
          ? `/objects/${published.id}/public`
          : `/downloads/${cid}`
      const charge = jest.spyOn(AccountsUseCases, 'registerInteraction')
      const response = await fetch(`${BASE}${path}`, {
        headers: { authorization: 'Bearer test', 'x-auth-provider': 'google' },
      })

      expect(response.status).toBe(503)
      // A body the client can actually read, and no Content-Length promising bytes
      // that will never arrive.
      const body = await response.text()
      expect(JSON.parse(body)).toEqual({
        error: 'The object is temporarily unavailable. Please retry.',
      })
      expect(body).not.toContain(doomed)
      expect(response.headers.get('retry-after')).toBe('1')
      expect(charge).not.toHaveBeenCalled()
      expect(response.headers.get('content-length')).not.toBe(
        String(value.totalSize),
      )
    },
  )

  it.each(['authenticated', 'public'])(
    '%s download answers 402 without constructing a stream',
    async (route) => {
      const created = await UploadsUseCases.createFileUpload(
        user,
        `credits-${v4()}.bin`,
        'application/octet-stream',
        null,
      )
      await UploadsUseCases.uploadChunk(
        user,
        created.id,
        0,
        randomBytes(64 * 1024),
      )
      const cid = await UploadsUseCases.completeUpload(user, created.id)
      const published = await ObjectUseCases.publishObject(user, cid)
      const account = await AccountsUseCases.getOrCreateAccount(user)
      const db = await getDatabase()
      await db.query('UPDATE accounts SET download_limit = 0 WHERE id = $1', [
        account.id,
      ])
      const download = jest.spyOn(downloadService, 'download')
      try {
        const path =
          route === 'public'
            ? `/objects/${published.id}/public`
            : `/downloads/${cid}`
        const response = await fetch(`${BASE}${path}`, {
          headers: {
            authorization: 'Bearer test',
            'x-auth-provider': 'google',
          },
        })
        expect(response.status).toBe(402)
        expect(await response.json()).toEqual({
          error: 'Insufficient credits to process download',
        })
        expect(download).not.toHaveBeenCalled()
      } finally {
        await db.query(
          'UPDATE accounts SET download_limit = $1 WHERE id = $2',
          [account.downloadLimit, account.id],
        )
      }
    },
  )
})
