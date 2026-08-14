import { jest } from '@jest/globals'
import { Readable } from 'stream'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { ok } from 'neverthrow'
import { asyncIterableToPromiseOfArray } from '@autonomys/asynchronous'

/**
 * The gateway fetcher composes an uncached file out of per-chunk requests
 * instead of the SDK's one-chunk-per-read stream. These cover what changes if
 * that composition is wrong in a way a smoke test would not notice: the bytes
 * must come back in chunk order and exactly once, the end of the file is
 * decided by the gateway's 204 rather than by our chunk count, and a file the
 * gateway already holds must not be composed chunk by chunk at all.
 *
 * Concurrency and the retry delay are turned down here so a multi-batch file
 * stays small enough to assert on byte for byte.
 */
const CHUNK_CONCURRENCY = 4
process.env.FILES_GATEWAY_CHUNK_CONCURRENCY = String(CHUNK_CONCURRENCY)
process.env.FILES_GATEWAY_CHUNK_RETRY_DELAY_MS = '1'

const fetchFileChunk =
  jest.fn<(cid: string, chunk: number) => Promise<Buffer | null>>()
const isFileCachedOnGateway = jest.fn<(cid: string) => Promise<boolean>>()
const fetchGatewayFile = jest.fn<(cid: string) => Promise<Readable>>()

jest.unstable_mockModule(
  '../../../src/infrastructure/services/dsn/fileGateway/index.js',
  () => ({
    fetchFileChunk,
    isFileCachedOnGateway,
    fetchGatewayFile,
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

const requestedChunks = (): number[] =>
  fetchFileChunk.mock.calls.map(([, chunk]) => chunk)

describe('FileGatewayObjectFetcher.fetchFile', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isFileCachedOnGateway.mockResolvedValue(false)
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

  /**
   * The regression that matters, and the reason read() must not be async.
   *
   * push() clears Node's own re-entrancy guard, so a read() that pushes and
   * then awaits gets called again while it is still suspended. Both calls read
   * the same cursor and request the same range. Two conditions arm it, and both
   * hold in production: a chunk payload just under the 64 KiB high-water mark
   * (the gateway's is 65,066), so a single push leaves the buffer with room and
   * returns true; and any latency on the chunk request, so the second call
   * lands during the await.
   *
   * What it costs depends on who wins the race. Measured against the previous
   * implementation at this shape: 37 requests for a 21-request file, 16 of the
   * 20 chunks fetched twice — the gateway doing half its work again on the one
   * path this PR exists to make cheaper. When the consumer is slower than the
   * gateway, which is the normal case for a browser on a real connection, the
   * duplicate arrives before end-of-stream and is emitted as file content
   * instead of being dropped: a download longer than the file, under a content
   * address, written into the cache for everyone behind it.
   *
   * The request-side assertion is the deterministic one; the byte assertion
   * catches the same defect only when the timing exposes it.
   */
  it('requests and emits every chunk exactly once across several batches', async () => {
    const CHUNKS = CHUNK_CONCURRENCY * 5
    const CHUNK_SIZE = 65066 // the gateway's payload size, just under the mark
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(ok(metadataWithChunks(CHUNKS)))

    const chunkBytes = (chunk: number) =>
      Buffer.alloc(CHUNK_SIZE, `${chunk % 10}`)

    fetchFileChunk.mockImplementation(async (_cid, chunk) => {
      if (chunk >= CHUNKS) return null
      await new Promise((resolve) => setTimeout(resolve, 1))
      return chunkBytes(chunk)
    })

    const expected = Buffer.concat(
      Array.from({ length: CHUNKS }, (_, i) => chunkBytes(i)),
    )
    const received = await readAll('test-cid')

    const requested = requestedChunks().filter((chunk) => chunk < CHUNKS)
    expect(requested.length).toBe(CHUNKS)
    expect(new Set(requested).size).toBe(CHUNKS)

    expect(received.length).toBe(expected.length)
    expect(received.equals(expected)).toBe(true)
  })

  it('keeps at most FILES_GATEWAY_CHUNK_CONCURRENCY requests in flight', async () => {
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(ok(metadataWithChunks(CHUNK_CONCURRENCY * 3)))

    let inFlight = 0
    let peakInFlight = 0
    fetchFileChunk.mockImplementation(async (_cid, chunk) => {
      if (chunk >= CHUNK_CONCURRENCY * 3) return null
      inFlight++
      peakInFlight = Math.max(peakInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return Buffer.from('x')
    })

    await readAll('test-cid')

    // Serially this peaks at 1 and a 19,649-chunk object costs 19,649
    // sequential round-trips; unbounded it would open all 19,649 at once and
    // bury the gateway. Both directions have to be pinned.
    expect(peakInFlight).toBeGreaterThan(1)
    expect(peakInFlight).toBeLessThanOrEqual(CHUNK_CONCURRENCY)
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

  it('discards whatever a batch returns after the gateway 204s', async () => {
    // The 204 can land mid-batch while the requests after it are still in
    // flight and still returning bytes. Appending those would put data past the
    // end of the file.
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(ok(metadataWithChunks(CHUNK_CONCURRENCY)))

    fetchFileChunk.mockImplementation(async (_cid, chunk) => {
      if (chunk === 1) return null
      return Buffer.from(`[${chunk}]`)
    })

    expect((await readAll('test-cid')).toString()).toBe('[0]')
  })

  it('retries a chunk that fails transiently instead of failing the file', async () => {
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(ok(metadataWithChunks(3)))

    // One flaky request out of ~19,650 is a near-certainty on a large object,
    // and without a retry it takes the whole retrieval with it.
    let failuresLeft = 1
    fetchFileChunk.mockImplementation(async (_cid, chunk) => {
      if (chunk >= 3) return null
      if (chunk === 1 && failuresLeft > 0) {
        failuresLeft--
        throw new Error('gateway hiccup')
      }
      return Buffer.from(`[${chunk}]`)
    })

    expect((await readAll('test-cid')).toString()).toBe('[0][1][2]')
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

  it('streams a file the gateway already holds in one request', async () => {
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(ok(metadataWithChunks(1000)))

    isFileCachedOnGateway.mockResolvedValue(true)
    fetchGatewayFile.mockResolvedValue(Readable.from([Buffer.from('cached')]))

    expect((await readAll('test-cid')).toString()).toBe('cached')

    // Composing it per chunk would be a thousand requests, each a fresh DAG
    // walk gateway-side, for bytes it has on disk.
    expect(fetchGatewayFile).toHaveBeenCalledWith('test-cid')
    expect(fetchFileChunk).not.toHaveBeenCalled()
  })
})
