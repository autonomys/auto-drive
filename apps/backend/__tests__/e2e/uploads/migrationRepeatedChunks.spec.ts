import { jest } from '@jest/globals'
import { createHash, randomBytes } from 'crypto'
import { MemoryBlockstore } from 'blockstore-core'
import {
  cidOfNode,
  cidToString,
  decodeNode,
  DEFAULT_MAX_CHUNK_SIZE,
  IPLDNodeData,
  processFileToIPLDFormat,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { UploadStatus } from '@auto-drive/models'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { NodesUseCases } from '../../../src/core/objects/nodes.js'
import { AccountsUseCases } from '../../../src/core/index.js'
import { nodesRepository } from '../../../src/infrastructure/repositories/index.js'
import { blockstoreRepository } from '../../../src/infrastructure/repositories/uploads/index.js'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { getUploadBlockstore } from '../../../src/infrastructure/services/upload/uploadProcessorCache/index.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(600_000)

const MiB = 1024 * 1024

interface Statement {
  text: string
  rows: number
  payloadBytes: number
}

/**
 * Every statement `fn` sends, with the rows and blockstore payload bytes that
 * came back for it — the traffic the incident was billed for.
 */
const recordQueries = async <T>(fn: () => Promise<T>) => {
  const db = await getDatabase()
  const query = db.query.bind(db) as (...args: any[]) => Promise<any>
  const statements: Statement[] = []
  const spy = jest.spyOn(db, 'query').mockImplementation((async (
    ...args: any[]
  ) => {
    const result = await query(...args)
    const rows: any[] = result.rows ?? []
    statements.push({
      text: typeof args[0] === 'string' ? args[0] : args[0].text,
      rows: rows.length,
      payloadBytes: rows.reduce(
        (sum, row) => sum + (Buffer.isBuffer(row.data) ? row.data.length : 0),
        0,
      ),
    })
    return result
  }) as any)
  try {
    return { result: await fn(), statements }
  } finally {
    spy.mockRestore()
  }
}

const sql = async <T>(text: string, values: unknown[]) =>
  (await (await getDatabase()).query(text, values)).rows as T[]

const occurrencesByCid = (uploadId: string) =>
  sql<{ cid: string; rows: number; first_sort_id: number }>(
    `SELECT cid, COUNT(*)::int AS rows, MIN(sort_id) AS first_sort_id
       FROM uploads.blockstore WHERE upload_id = $1
      GROUP BY cid ORDER BY rows DESC, first_sort_id ASC`,
    [uploadId],
  )

/**
 * Reads the file back out of the nodes table alone, checking on the way that
 * every node hashes to the CID it is stored under.
 */
const readFileFromNodes = async (rootCid: string) => {
  const hash = createHash('sha256')
  const decoded = new Map<string, ReturnType<typeof decodeNode>>()
  let size = 0

  const visit = async (cid: string): Promise<void> => {
    let node = decoded.get(cid)
    if (!node) {
      const encoded = await NodesUseCases.getNode(cid)
      expect(encoded).toBeDefined()
      node = decodeNode(Buffer.from(encoded!, 'base64'))
      expect(cidToString(cidOfNode(node))).toBe(cid)
      decoded.set(cid, node)
    }
    if (node.Links.length === 0) {
      const data = IPLDNodeData.decode(node.Data!).data ?? new Uint8Array()
      hash.update(data)
      size += data.length
    }
    for (const link of node.Links) {
      await visit(cidToString(link.Hash))
    }
  }

  await visit(rootCid)
  return { size, sha256: hash.digest('hex') }
}

const sha256Of = (parts: Buffer[]) => {
  const hash = createHash('sha256')
  parts.forEach((part) => hash.update(part))
  return hash.digest('hex')
}

describe('migration of uploads that repeat a chunk', () => {
  const user = createMockUser()
  let published: ReturnType<typeof mockRabbitPublish>

  beforeAll(async () => {
    published = mockRabbitPublish()
    await dbMigration.up()
    // 150 MiB is over the free tier; credits are not what this is testing.
    jest
      .spyOn(AccountsUseCases, 'getPendingCreditsByUserAndType')
      .mockResolvedValue(Number.MAX_SAFE_INTEGER)
    jest
      .spyOn(AccountsUseCases, 'registerInteraction')
      .mockResolvedValue(undefined as any)
  })

  afterAll(async () => {
    await dbMigration.down()
    unmockMethods()
  })

  const upload = async (name: string, parts: Buffer[]) => {
    const created = await UploadsUseCases.createFileUpload(
      user,
      name,
      'application/octet-stream',
      null,
    )
    for (const [index, part] of parts.entries()) {
      await UploadsUseCases.uploadChunk(user, created.id, index, part)
    }
    const cid = await UploadsUseCases.completeUpload(user, created.id)
    return { uploadId: created.id, cid }
  }

  const nodesOf = (rootCid: string) =>
    sql<{ cid: string; rows: number }>(
      'SELECT cid, COUNT(*)::int AS rows FROM nodes WHERE root_cid = $1 GROUP BY cid',
      [rootCid],
    )

  // `truncate -s 150M zeros-150M.bin`: 2,417 identical full chunks, a short
  // tail chunk, two inlink nodes (2,418 links at 1,626 per node) and the root.
  describe('the 150 MiB zero-filled file from the incident', () => {
    const NAME = 'zeros-150M.bin'
    const SIZE = 150 * MiB
    const zeroPart = Buffer.alloc(MiB)
    const parts = Array.from({ length: SIZE / MiB }, () => zeroPart)
    let uploadId: string
    let cid: string
    let shape: Awaited<ReturnType<typeof occurrencesByCid>>

    beforeAll(async () => {
      ;({ uploadId, cid } = await upload(NAME, parts))
      shape = await occurrencesByCid(uploadId)
    })

    it('stores the blockstore shape the incident did', () => {
      expect(shape.map(({ rows }) => rows)).toEqual([2417, 1, 1, 1, 1])
    })

    it('reads a single block as one row, the first one written', async () => {
      const [zeroChunk] = shape

      const { result, statements } = await recordQueries(() =>
        blockstoreRepository.getByCid(uploadId, zeroChunk.cid),
      )

      expect(statements).toHaveLength(1)
      expect(statements[0].rows).toBe(1)
      expect(statements[0].payloadBytes).toBeLessThanOrEqual(65535)
      expect((result as any).sort_id).toBe(zeroChunk.first_sort_id)
    })

    it('reads sizes and existence without reading a payload', async () => {
      const [zeroChunk] = shape
      const blockstore = await getUploadBlockstore(uploadId)

      const { result, statements } = await recordQueries(async () => ({
        withoutData: await blockstoreRepository.getByCIDWithoutData(
          uploadId,
          zeroChunk.cid,
        ),
        byRoot: await blockstoreRepository.getByCIDAndRootUploadId(
          uploadId,
          zeroChunk.cid,
        ),
        size: await blockstore.getSize(stringToCid(zeroChunk.cid)),
        has: await blockstore.has(stringToCid(zeroChunk.cid)),
        hasUnknown: await blockstoreRepository.hasCid(uploadId, 'not-a-cid'),
      }))

      expect(result.has).toBe(true)
      expect(result.hasUnknown).toBe(false)
      expect(result.withoutData?.cid).toBe(zeroChunk.cid)
      expect(result.byRoot?.node_size).toBe(result.withoutData?.node_size)
      expect(result.size).toBe(BigInt(result.withoutData!.node_size))
      expect(statements.map((s) => s.rows)).toEqual([1, 1, 1, 1, 1])
      expect(statements.every((s) => s.payloadBytes === 0)).toBe(true)
    })

    it('lists each CID once, in first-written order, and fetches each once', async () => {
      const firstWritten = [...shape]
        .sort((a, b) => a.first_sort_id - b.first_sort_id)
        .map((row) => row.cid)

      expect(await blockstoreRepository.getDistinctCids(uploadId)).toEqual(
        firstWritten,
      )

      const entries = await blockstoreRepository.getFirstEntriesByCids(
        uploadId,
        firstWritten,
      )
      expect(entries.map((entry) => entry.cid)).toEqual(firstWritten)
      expect(entries.map((entry: any) => entry.sort_id)).toEqual(
        [...shape].map((row) => row.first_sort_id).sort((a, b) => a - b),
      )
    })

    it('migrates reading each distinct payload once', async () => {
      const firstEntries = jest.spyOn(
        blockstoreRepository,
        'getFirstEntriesByCids',
      )
      firstEntries.mockClear()
      const started = Date.now()

      const { statements } = await recordQueries(() =>
        UploadsUseCases.processMigration(uploadId),
      )

      const fetched = await Promise.all(
        firstEntries.mock.results.map((r) => r.value as Promise<unknown[]>),
      )
      firstEntries.mockRestore()
      expect(fetched.flat()).toHaveLength(5)
      // Every payload byte read from the blockstore during the whole migration,
      // root lookups included. Reading one row per occurrence would be at least
      // 150 MiB; one per occurrence per occurrence, as before, about 370 GB.
      const payloadBytes = statements.reduce((n, s) => n + s.payloadBytes, 0)
      expect(payloadBytes).toBeLessThan(MiB)
      expect(statements.length).toBeLessThan(40)
      expect(Date.now() - started).toBeLessThan(30_000)
    })

    it('leaves a nodes table that reproduces the file', async () => {
      const nodes = await nodesOf(cid)
      expect(nodes).toHaveLength(5)
      expect(nodes.every(({ rows }) => rows === 1)).toBe(true)
      expect(nodes.map((node) => node.cid).sort()).toEqual(
        shape.map((row) => row.cid).sort(),
      )

      const file = await readFileFromNodes(cid)
      expect(file.size).toBe(SIZE)
      expect(file.sha256).toBe(sha256Of(parts))

      // The same CID a single pass of the library's own builder gives the same
      // bytes, and the same bytes for every node it produced.
      const reference = new MemoryBlockstore()
      const referenceCid = await processFileToIPLDFormat(
        reference,
        parts,
        BigInt(SIZE),
        NAME,
      )
      expect(cidToString(referenceCid)).toBe(cid)
      for (const { cid: nodeCid } of nodes) {
        const stored = await NodesUseCases.getNode(nodeCid)
        const expected = await reference.get(stringToCid(nodeCid))
        expect(
          Buffer.from(stored!, 'base64').equals(Buffer.from(expected)),
        ).toBe(true)
      }
    })

    it('cleans up the upload and hands the object on', async () => {
      expect(await occurrencesByCid(uploadId)).toHaveLength(0)
      expect(await uploadsRepository.getUploadEntryById(uploadId)).toBeNull()

      const tasks = published.mock.calls.map(([, task]) => task as any)
      expect(tasks).toContainEqual(
        expect.objectContaining({ id: 'tag-upload', params: { cid } }),
      )
      expect(tasks).toContainEqual(
        expect.objectContaining({ id: 'populate-cache', params: { cid } }),
      )
    })
  })

  // Distinct chunks either side of a run of repeats, so there are two batches of
  // distinct CIDs and the repeats of the first chunk sit far from it — 121 rows
  // after it, in a later batch of rows.
  it('finishes cleanly when retried after failing part-way through', async () => {
    const zero = Buffer.alloc(DEFAULT_MAX_CHUNK_SIZE)
    const distinct = () => randomBytes(DEFAULT_MAX_CHUNK_SIZE)
    const content = Buffer.concat([
      zero,
      ...Array.from({ length: 120 }, distinct),
      ...Array.from({ length: 50 }, () => zero),
      ...Array.from({ length: 30 }, distinct),
    ])
    const parts: Buffer[] = []
    for (let offset = 0; offset < content.length; offset += MiB) {
      parts.push(content.subarray(offset, offset + MiB))
    }
    const { uploadId, cid } = await upload('mixed.bin', parts)

    const shape = await occurrencesByCid(uploadId)
    expect(shape[0].rows).toBe(51)
    expect(shape).toHaveLength(152)

    const saveNodes = nodesRepository.saveNodes
    jest
      .spyOn(nodesRepository, 'saveNodes')
      .mockImplementationOnce(saveNodes)
      .mockImplementationOnce(async () => {
        throw new Error('connection terminated unexpectedly')
      })

    await expect(UploadsUseCases.processMigration(uploadId)).rejects.toThrow(
      'connection terminated unexpectedly',
    )
    jest.mocked(nodesRepository.saveNodes).mockRestore()

    // Partial progress: the first batch is written, nothing was cleaned up, and
    // the upload is still waiting to be migrated.
    expect(await nodesOf(cid)).toHaveLength(100)
    expect(await occurrencesByCid(uploadId)).toEqual(shape)
    expect((await uploadsRepository.getUploadEntryById(uploadId))?.status).toBe(
      UploadStatus.MIGRATING,
    )

    await UploadsUseCases.processMigration(uploadId)

    const nodes = await nodesOf(cid)
    expect(nodes).toHaveLength(152)
    expect(nodes.every(({ rows }) => rows === 1)).toBe(true)
    const file = await readFileFromNodes(cid)
    expect(file.size).toBe(content.length)
    expect(file.sha256).toBe(sha256Of([content]))
    expect(await occurrencesByCid(uploadId)).toHaveLength(0)
  })
})
