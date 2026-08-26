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
import { NodesUseCases } from '../../../src/core/objects/nodes.js'
import { FilesUseCases } from '../../../src/core/objects/files/index.js'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { nodesRepository } from '../../../src/infrastructure/repositories/index.js'
import { blockstoreRepository } from '../../../src/infrastructure/repositories/uploads/index.js'
import { BlockstoreUseCases } from '../../../src/core/uploads/blockstore.js'

jest.setTimeout(300_000)

/**
 * Issue #815 — an object was unreadable while its blockstore->nodes migration
 * was in flight, failing mid-stream with `Chunk not found`.
 *
 * The cause was not that the migration consumed the blockstore as it went (it
 * does not — see 'migration leaves the blockstore intact'). It was that chunk
 * resolution read `nodes` and `uploads.blockstore` in two separate statements.
 * Under READ COMMITTED each statement takes its own snapshot, so a reader could
 * miss a CID in `nodes` before the migration's INSERTs committed and miss it
 * again in the blockstore after removeUploadArtifacts' DELETE committed —
 * resolving neither copy of a node that was continuously present in one table
 * or the other.
 */
describe('chunk resolution during migration (issue #815)', () => {
  const user = createMockUser()

  beforeAll(async () => {
    mockRabbitPublish()
    await dbMigration.up()
  })
  afterAll(async () => {
    await dbMigration.down()
    unmockMethods()
    jest.clearAllMocks()
  })

  const upload = async (content: Buffer, name = `race-${v4()}.bin`) => {
    const created = await UploadsUseCases.createFileUpload(
      user,
      name,
      'application/octet-stream',
      null,
    )
    await UploadsUseCases.uploadChunk(user, created.id, 0, content)
    const cid = await UploadsUseCases.completeUpload(user, created.id)
    return { uploadId: created.id, cid, content }
  }

  const chunkCidsOf = async (cid: string): Promise<string[]> => {
    const metadata = await ObjectUseCases.getMetadata(cid)
    if (metadata.isErr()) throw new Error(`no metadata for ${cid}`)
    const value = metadata.value
    if (value.type !== 'file') throw new Error(`${cid} is not a file`)
    return value.chunks.map((chunk) => chunk.cid)
  }

  it('migration leaves the blockstore intact until it has finished', async () => {
    // Large enough to span more than one BATCH_SIZE=100 insert, so the
    // observation below is made *between* batches and not just at the end.
    const { uploadId } = await upload(randomBytes(12 * 1024 * 1024))
    const before =
      await blockstoreRepository.getBlockstoreEntriesWithoutData(uploadId)
    expect(before.length).toBeGreaterThan(1)

    // Observe the blockstore after every batch insert, not just at the end.
    const realSaveNodes = nodesRepository.saveNodes.bind(nodesRepository)
    const perBatch: number[] = []
    const spy = jest.spyOn(nodesRepository, 'saveNodes')
    spy.mockImplementation(async (nodes) => {
      const result = await realSaveNodes(nodes)
      perBatch.push(
        (await blockstoreRepository.getBlockstoreEntriesWithoutData(uploadId))
          .length,
      )
      return result
    })

    await NodesUseCases.migrateFromBlockstoreToNodesTable(uploadId)
    spy.mockRestore()

    expect(perBatch.length).toBeGreaterThan(1)
    for (const remaining of perBatch) expect(remaining).toBe(before.length)
  })

  it('resolves a chunk whose migration commits between the two lookups', async () => {
    const { uploadId, cid } = await upload(randomBytes(1024 * 1024))
    const chunks = await chunkCidsOf(cid)
    const target = chunks[chunks.length - 1]

    // Not migrated yet: resolvable only from the blockstore.
    expect(await nodesRepository.getNode(target)).toBeUndefined()
    expect(await NodesUseCases.getChunkData(target)).toBeDefined()

    // Drive the exact production interleaving: the whole migration (node
    // INSERTs *and* the blockstore cleanup) commits while a reader is partway
    // through resolving this chunk. Before the fix this returned undefined and
    // surfaced as `Chunk not found` mid-stream.
    let migrated = false
    const realResolve =
      nodesRepository.resolveEncodedNodes.bind(nodesRepository)
    const spy = jest.spyOn(nodesRepository, 'resolveEncodedNodes')
    spy.mockImplementation(async (cids) => {
      if (!migrated && cids.includes(target)) {
        migrated = true
        await UploadsUseCases.processMigration(uploadId)
      }
      return realResolve(cids)
    })

    const chunkData = await NodesUseCases.getChunkData(target)
    spy.mockRestore()

    expect(migrated).toBe(true)
    expect(chunkData).toBeDefined()
  })

  it('serves a full object read concurrently with its own migration', async () => {
    const SIZE = 12 * 1024 * 1024
    const attempts = 3

    for (let attempt = 0; attempt < attempts; attempt++) {
      const { uploadId, cid, content } = await upload(randomBytes(SIZE))
      const metadata = await ObjectUseCases.getMetadata(cid)
      if (metadata.isErr()) throw new Error('no metadata')

      const stream = await FilesUseCases.retrieveFullFile(metadata.value)

      // Model production pool queueing. The composer fetches chunks 100 at a
      // time against a pg.Pool with the default max of 10 connections, so a
      // resolution could lag far behind the reader that issued it. Locally
      // every statement is sub-millisecond, which is too fast to land in the
      // window unaided; this delay stands in for that queueing. Nothing about
      // the resolution logic under test is mocked.
      const realGetNode = BlockstoreUseCases.getNode
      const slow = jest.spyOn(BlockstoreUseCases, 'getNode')
      slow.mockImplementation(async (c: string) => {
        await new Promise((resolve) => setTimeout(resolve, 150))
        return realGetNode(c)
      })

      const migration = UploadsUseCases.processMigration(uploadId)

      let received = 0
      let streamError: Error | undefined
      try {
        for await (const buf of stream) {
          received += (buf as Buffer).length
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
      } catch (error) {
        streamError = error as Error
      }
      await migration
      slow.mockRestore()

      expect(streamError).toBeUndefined()
      expect(received).toBe(content.length)
    }
  })

  it('keeps an already-migrated object readable while the same root re-migrates', async () => {
    const content = randomBytes(8 * 1024 * 1024)
    const name = `race-dup-${v4()}.bin`

    const first = await upload(content, name)
    await UploadsUseCases.processMigration(first.uploadId)

    const chunks = await chunkCidsOf(first.cid)
    const target = chunks[chunks.length - 1]
    expect(await NodesUseCases.getChunkData(target)).toBeDefined()
    expect((await blockstoreRepository.getNodesByCid(target)).length).toBe(0)

    // Same name and bytes -> same root CID, new upload, its own blockstore.
    // Its migration opens with `DELETE FROM nodes WHERE root_cid = R`, which
    // removes the first upload's rows.
    const second = await upload(content, name)
    expect(second.cid).toBe(first.cid)

    let unresolvable = 0
    let samples = 0
    let polling = true
    const poller = (async () => {
      while (polling) {
        if ((await NodesUseCases.getChunkData(target)) === undefined) {
          unresolvable++
        }
        samples++
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })()

    await UploadsUseCases.processMigration(second.uploadId)
    polling = false
    await poller

    expect(samples).toBeGreaterThan(10)
    expect(unresolvable).toBe(0)
  })
})
