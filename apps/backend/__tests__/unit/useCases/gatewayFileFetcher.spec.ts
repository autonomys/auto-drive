import { jest } from '@jest/globals'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { ok } from 'neverthrow'
import { asyncIterableToPromiseOfArray } from '@autonomys/asynchronous'

/**
 * The gateway fetcher composes a file out of per-chunk requests instead of the
 * SDK's one-chunk-per-read stream. These cover the two things that change if
 * that composition is wrong in a way a smoke test would not notice: the bytes
 * must come back in chunk order, and the end of the file is decided by the
 * gateway's 204 rather than by our chunk count.
 */
const fetchFileChunk = jest.fn<(cid: string, chunk: number) => Promise<Buffer | null>>()

jest.unstable_mockModule(
  '../../../src/infrastructure/services/dsn/fileGateway/index.js',
  () => ({
    fetchFileChunk,
    FileGateway: { getNode: jest.fn() },
  }),
)

const { FileGatewayObjectFetcher } = await import(
  '../../../src/core/objects/files/fetchers.js'
)
const { ObjectUseCases } = await import('../../../src/core/objects/object.js')

const metadataWithChunks = (count: number): OffchainMetadata =>
  ({
    totalSize: BigInt(count),
    type: 'file',
    dataCid: 'test-cid',
    totalChunks: count,
    chunks: Array.from({ length: count }, (_, i) => ({
      cid: `chunk-${i}`,
      size: 1n,
    })),
  }) as unknown as OffchainMetadata

const readAll = async (cid: string): Promise<Buffer> => {
  const stream = await FileGatewayObjectFetcher.fetchFile(cid)
  return Buffer.concat(await asyncIterableToPromiseOfArray(stream))
}

describe('FileGatewayObjectFetcher.fetchFile', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reassembles chunks in order regardless of the order they resolve in', async () => {
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(ok(metadataWithChunks(5)))

    // Resolve earlier chunks later, so a composer that emitted on completion
    // rather than by index would produce visibly scrambled output.
    fetchFileChunk.mockImplementation(async (_cid, chunk) => {
      if (chunk >= 5) return null
      await new Promise((resolve) => setTimeout(resolve, (5 - chunk) * 5))
      return Buffer.from(`[${chunk}]`)
    })

    expect((await readAll('test-cid')).toString()).toBe('[0][1][2][3][4]')
  })

  it('issues the chunk requests concurrently rather than one at a time', async () => {
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(ok(metadataWithChunks(8)))

    let inFlight = 0
    let peakInFlight = 0
    fetchFileChunk.mockImplementation(async (_cid, chunk) => {
      if (chunk >= 8) return null
      inFlight++
      peakInFlight = Math.max(peakInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return Buffer.from('x')
    })

    await readAll('test-cid')

    // The whole point of this fetcher: serially it would peak at 1, and a
    // 19,649-chunk object would cost 19,649 sequential round-trips.
    expect(peakInFlight).toBeGreaterThan(1)
  })

  it('ends the file where the gateway says it ends, not where our count does', async () => {
    // Metadata claims 3 chunks; the gateway 204s after 2. The 204 wins, so the
    // file ends cleanly instead of hanging on a chunk that will never arrive.
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(ok(metadataWithChunks(3)))

    fetchFileChunk.mockImplementation(async (_cid, chunk) =>
      chunk < 2 ? Buffer.from(`[${chunk}]`) : null,
    )

    expect((await readAll('test-cid')).toString()).toBe('[0][1]')
  })

  it('propagates a chunk failure instead of truncating the file', async () => {
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(ok(metadataWithChunks(4)))

    fetchFileChunk.mockImplementation(async (_cid, chunk) => {
      if (chunk === 2) throw new Error('gateway exploded')
      return Buffer.from(`[${chunk}]`)
    })

    // Silently ending the stream here would hand the user a short file that
    // looks like a successful download.
    await expect(readAll('test-cid')).rejects.toThrow('gateway exploded')
  })
})
