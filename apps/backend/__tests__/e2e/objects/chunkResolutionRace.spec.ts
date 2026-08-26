import { jest } from '@jest/globals'
import { v4 } from 'uuid'
import { randomBytes } from 'crypto'
import {
  cidToString,
  createSingleFileIpldNode,
  cidOfNode,
  encodeNode,
  MetadataType,
} from '@autonomys/auto-dag-data'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { NodesUseCases } from '../../../src/core/objects/nodes.js'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { nodesRepository } from '../../../src/infrastructure/repositories/index.js'
import { blockstoreRepository } from '../../../src/infrastructure/repositories/uploads/index.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'

jest.setTimeout(300_000)

/**
 * Issue #815 — reads of a just-uploaded object failed mid-stream with
 * `Chunk not found` while its blockstore->nodes migration was in flight.
 *
 * The cause was that chunk resolution read `nodes` and `uploads.blockstore` in
 * TWO statements. Under READ COMMITTED each takes its own snapshot, so a reader
 * could miss a CID in the first (before the migration's INSERTs committed) and
 * miss it again in the second (after the cleanup's DELETE committed) — never
 * seeing a node that was continuously present in one table or the other.
 *
 * The property that fixes it is exactly "one statement", so that is what these
 * tests assert. An earlier version of this file tried to provoke the race with
 * injected sleeps instead; every one of those tests passed against a
 * deliberately reintroduced two-statement resolution, because the window they
 * were trying to hit is sub-millisecond on a local database. Timing cannot prove
 * the absence of a race. The statement count can.
 */
describe('chunk resolution (issue #815)', () => {
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
    return { uploadId: created.id, cid }
  }

  const chunkCidsOf = async (cid: string): Promise<string[]> => {
    const metadata = await ObjectUseCases.getMetadata(cid)
    if (metadata.isErr()) throw new Error(`no metadata for ${cid}`)
    const value = metadata.value
    if (value.type !== 'file') throw new Error(`${cid} is not a file`)
    return value.chunks.map((chunk) => chunk.cid)
  }

  /** Count SQL round trips made while `fn` runs. */
  const countQueries = async <T>(
    fn: () => Promise<T>,
  ): Promise<{ result: T; queries: number }> => {
    const db = await getDatabase()
    const spy = jest.spyOn(db, 'query')
    const before = spy.mock.calls.length
    try {
      const result = await fn()
      return { result, queries: spy.mock.calls.length - before }
    } finally {
      spy.mockRestore()
    }
  }

  // THE regression test. Two statements are what made the bug possible, so a
  // resolution that costs more than one statement is the bug, whether or not a
  // race happens to reproduce on this machine today.
  it('resolves any number of chunks in exactly one statement', async () => {
    const { cid } = await upload(randomBytes(4 * 1024 * 1024))
    const chunks = await chunkCidsOf(cid)
    expect(chunks.length).toBeGreaterThan(10)

    // Un-migrated: every chunk lives in the blockstore, none in `nodes`. This is
    // the shape that used to need a second statement.
    expect(await nodesRepository.getNode(chunks[0])).toBeUndefined()

    const { result, queries } = await countQueries(() =>
      NodesUseCases.getChunksData(chunks),
    )

    expect(result.size).toBe(chunks.length)
    expect(queries).toBe(1)
  })

  it('resolves a single chunk in one statement, from either table', async () => {
    const { uploadId, cid } = await upload(randomBytes(512 * 1024))
    const [chunk] = await chunkCidsOf(cid)

    const fromBlockstore = await countQueries(() =>
      NodesUseCases.getChunkData(chunk),
    )
    expect(fromBlockstore.result).toBeDefined()
    expect(fromBlockstore.queries).toBe(1)

    await UploadsUseCases.processMigration(uploadId)
    expect((await blockstoreRepository.getBlockstoreEntries(uploadId)).length).toBe(0)

    const fromNodes = await countQueries(() => NodesUseCases.getChunkData(chunk))
    expect(fromNodes.result).toBeDefined()
    expect(fromNodes.queries).toBe(1)
  })

  // Precedence and the NULL filter are the two things the single statement has
  // to get right, and neither is observable through the normal write path
  // (content addressing makes both copies byte-identical). Written directly so
  // the two sources are distinguishable.
  describe('resolution precedence', () => {
    const seed = async (
      nodesEncoded: string | null,
      blockstorePayload: Buffer | null,
    ) => {
      const text = `precedence-${v4()}`
      const node = createSingleFileIpldNode(Buffer.from(text), text)
      const cidString = cidToString(cidOfNode(node))
      const db = await getDatabase()

      if (nodesEncoded !== null) {
        await db.query(
          'INSERT INTO nodes (cid, root_cid, head_cid, type, encoded_node) VALUES ($1, $1, $1, $2, $3)',
          [cidString, MetadataType.FileChunk, nodesEncoded],
        )
      }
      if (blockstorePayload !== null) {
        const created = await UploadsUseCases.createFileUpload(
          user,
          `${text}.bin`,
          'application/octet-stream',
          null,
        )
        await blockstoreRepository.addBlockstoreEntry(
          created.id,
          cidString,
          MetadataType.FileChunk,
          BigInt(blockstorePayload.length),
          blockstorePayload,
        )
      }
      return cidString
    }

    const encodedFor = (text: string) =>
      Buffer.from(
        encodeNode(createSingleFileIpldNode(Buffer.from(text), text)),
      )

    it('prefers the durable nodes row over a blockstore row', async () => {
      const cid = await seed(
        encodedFor('from-nodes').toString('base64'),
        encodedFor('from-blockstore'),
      )
      // `nodes` is source 0 and must win. If the ORDER BY were reversed, a
      // pre-cleanup blockstore copy would shadow the committed row.
      expect((await NodesUseCases.getChunkData(cid))?.toString()).toBe(
        'from-nodes',
      )
    })

    it('falls through to the blockstore when the nodes row was stripped', async () => {
      const cid = await seed(null, encodedFor('from-blockstore'))
      const db = await getDatabase()
      // Archival NULLs encoded_node in place (removeNodeDataByRootCid). Without
      // the IS NOT NULL filter this row wins as source 0 and resolves to
      // nothing, even though a usable copy exists.
      await db.query(
        'INSERT INTO nodes (cid, root_cid, head_cid, type, encoded_node) VALUES ($1, $1, $1, $2, NULL)',
        [cid, MetadataType.FileChunk],
      )
      expect((await NodesUseCases.getChunkData(cid))?.toString()).toBe(
        'from-blockstore',
      )
    })

    it('does not resolve a chunk that is in neither table', async () => {
      const absent = cidToString(
        cidOfNode(createSingleFileIpldNode(Buffer.from('absent'), 'absent')),
      )
      expect(await NodesUseCases.getChunkData(absent)).toBeUndefined()
    })
  })

  // Characterisation, not regression: the issue asserted that the migration
  // "consumes" blockstore entries as it goes, which is what made a reader-side
  // fix look unnecessary. It does not — every row survives until cleanup — and
  // that is why one snapshot over both tables can always resolve.
  it('migration leaves the blockstore intact until it has finished', async () => {
    const { uploadId } = await upload(randomBytes(12 * 1024 * 1024))
    const before =
      await blockstoreRepository.getBlockstoreEntriesWithoutData(uploadId)
    expect(before.length).toBeGreaterThan(1)

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

  it('keeps an already-migrated object readable while the same root re-migrates', async () => {
    const content = randomBytes(8 * 1024 * 1024)
    const name = `race-dup-${v4()}.bin`

    const first = await upload(content, name)
    await UploadsUseCases.processMigration(first.uploadId)

    const chunks = await chunkCidsOf(first.cid)
    const target = chunks[chunks.length - 1]
    expect(await NodesUseCases.getChunkData(target)).toBeDefined()

    // Same name and bytes -> same root CID. Its migration opens with
    // `DELETE FROM nodes WHERE root_cid = R`, removing the first upload's rows
    // while it re-inserts them.
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
      }
    })()

    await UploadsUseCases.processMigration(second.uploadId)
    polling = false
    await poller

    expect(samples).toBeGreaterThan(100)
    expect(unresolvable).toBe(0)
  })
})
