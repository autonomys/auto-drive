import { jest } from '@jest/globals'
import { v4 } from 'uuid'
import { randomBytes } from 'crypto'
import { deflateSync } from 'zlib'
import express from 'express'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import {
  CompressionAlgorithm,
  FileUploadOptions,
} from '@autonomys/auto-dag-data'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { AccountsUseCases } from '../../../src/core/index.js'
import { downloadController } from '../../../src/app/controllers/download.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'

jest.setTimeout(120_000)

describe('download byte ranges', () => {
  const user = createMockUser()
  const data = randomBytes(256 * 1024)
  let server: Server
  let BASE: string
  let cid: string
  let firstChunkSize: number

  const upload = async (
    content: Buffer,
    uploadOptions: FileUploadOptions | null,
    mimeType = 'application/octet-stream',
  ) => {
    const created = await UploadsUseCases.createFileUpload(
      user,
      `range-${v4()}.bin`,
      mimeType,
      uploadOptions,
    )
    await UploadsUseCases.uploadChunk(user, created.id, 0, content)
    return UploadsUseCases.completeUpload(user, created.id)
  }

  const download = (objectCid: string, headers: Record<string, string>) =>
    fetch(`${BASE}/downloads/${objectCid}`, {
      headers: {
        authorization: 'Bearer test',
        'x-auth-provider': 'google',
        ...headers,
      },
    })

  beforeAll(async () => {
    await dbMigration.up()
    const app = express()
    app.use('/downloads', downloadController)
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s))
    })
    BASE = `http://localhost:${(server.address() as AddressInfo).port}`
    mockRabbitPublish()
    await AccountsUseCases.getOrCreateAccount(user)

    cid = await upload(data, null)
    const metadata = await ObjectUseCases.getMetadata(cid)
    if (metadata.isErr() || metadata.value.type !== 'file') {
      throw new Error('expected file metadata')
    }
    expect(metadata.value.chunks.length).toBeGreaterThan(1)
    firstChunkSize = Number(metadata.value.chunks[0].size)
  })
  beforeEach(() => {
    jest.spyOn(AuthManager, 'getUserFromAccessToken').mockResolvedValue(user)
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

  it.each<
    [string, (size: number, chunkSize: number) => [string, number, number]]
  >([
    ['the first byte', () => ['bytes=0-0', 0, 0]],
    [
      'a range across a chunk boundary',
      (_, chunkSize) => [
        `bytes=${chunkSize - 10}-${chunkSize + 9}`,
        chunkSize - 10,
        chunkSize + 9,
      ],
    ],
    [
      'an open-ended range',
      (size, chunkSize) => [`bytes=${chunkSize + 5}-`, chunkSize + 5, size - 1],
    ],
    ['a suffix range', (size) => ['bytes=-10', size - 10, size - 1]],
    [
      'a range ending past the file',
      (size) => [`bytes=${size - 3}-${size + 100}`, size - 3, size - 1],
    ],
  ])('serves %s with 206', async (_, range) => {
    const [header, start, end] = range(data.length, firstChunkSize)

    const response = await download(cid, { range: header })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(
      `bytes ${start}-${end}/${data.length}`,
    )
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      data.subarray(start, end + 1),
    )
  })

  it('answers 416 for a range starting at the end of the file', async () => {
    const response = await download(cid, { range: `bytes=${data.length}-` })

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe(`bytes */${data.length}`)
  })

  it.each([
    ['a compressed file', 'application/octet-stream'],
    ['compressed media', 'video/mp4'],
  ])('serves %s whole, ignoring the range', async (_, mimeType) => {
    const original = Buffer.from('the quick brown fox '.repeat(100))
    const compressedCid = await upload(
      deflateSync(original),
      { compression: { algorithm: CompressionAlgorithm.ZLIB } },
      mimeType,
    )

    const response = await download(compressedCid, {
      range: 'bytes=5-10',
      'accept-encoding': 'identity',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-range')).toBeNull()
    expect(response.headers.get('accept-ranges')).toBe('none')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(original)
  })
})
