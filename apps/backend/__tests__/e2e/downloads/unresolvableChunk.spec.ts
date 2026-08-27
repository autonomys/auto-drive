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
describe('GET /downloads/:cid with an unresolvable chunk', () => {
  const user = createMockUser()
  let server: Server
  let BASE: string

  beforeAll(async () => {
    await dbMigration.up()
    // Just the controller on an ephemeral port. Booting the whole download API
    // would race the s3-sdk suite for config.express.port.
    const app = express()
    app.use('/downloads', downloadController)
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s))
    })
    BASE = `http://localhost:${(server.address() as AddressInfo).port}`
    mockRabbitPublish()
    await AccountsUseCases.getOrCreateAccount(user)
    jest.spyOn(AuthManager, 'getUserFromAccessToken').mockResolvedValue(user)
  })
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await dbMigration.down()
    unmockMethods()
    jest.clearAllMocks()
  })

  it('answers 503 with a body, instead of committing a response it cannot finish', async () => {
    const created = await UploadsUseCases.createFileUpload(
      user,
      `unresolvable-${v4()}.bin`,
      'application/octet-stream',
      null,
    )
    // Multi-chunk, so this exercises the batch resolution rather than the
    // single-chunk shortcut.
    await UploadsUseCases.uploadChunk(user, created.id, 0, randomBytes(256 * 1024))
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

    const response = await fetch(`${BASE}/downloads/${cid}`, {
      headers: { authorization: 'Bearer test', 'x-auth-provider': 'google' },
    })

    expect(response.status).toBe(503)
    // A body the client can actually read, and no Content-Length promising bytes
    // that will never arrive.
    const body = await response.text()
    expect(body.length).toBeGreaterThan(0)
    expect(response.headers.get('content-length')).not.toBe(
      String(value.totalSize),
    )
  })
})
