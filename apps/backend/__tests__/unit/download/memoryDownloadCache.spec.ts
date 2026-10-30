import { jest, describe, it, expect, beforeAll, afterEach } from '@jest/globals'

const LIMIT = 1024 * 1024
process.env.MEMORY_DOWNLOAD_CACHE_MAX_SIZE = String(LIMIT)

let memoryDownloadCache: typeof import('../../../src/infrastructure/services/download/memoryDownloadCache/index.js').memoryDownloadCache

beforeAll(async () => {
  ;({ memoryDownloadCache } = await import(
    '../../../src/infrastructure/services/download/memoryDownloadCache/index.js'
  ))
})

const CHUNK_SIZE = 16 * 1024

const chunksOf = (count: number) =>
  Array.from({ length: count }, (_, i) => Buffer.alloc(CHUNK_SIZE, i))

async function* streamOf(chunks: Buffer[], onEnd: () => void = () => {}) {
  yield* chunks
  onEnd()
}

const read = async (iterable: AsyncIterable<Buffer> | null) => {
  const parts: Buffer[] = []
  for await (const part of iterable!) parts.push(part)
  return Buffer.concat(parts)
}

describe('memory download cache', () => {
  afterEach(async () => {
    jest.restoreAllMocks()
    await memoryDownloadCache.clear()
  })

  it('caches every byte of a multi-chunk object and serves ranges from it', async () => {
    const chunks = chunksOf(32)
    const whole = Buffer.concat(chunks)

    await memoryDownloadCache.set('cid', streamOf(chunks))

    expect(memoryDownloadCache.has('cid')).toBe(true)
    expect((await read(memoryDownloadCache.get('cid'))).equals(whole)).toBe(
      true,
    )
    const range = await read(
      memoryDownloadCache.get('cid', {
        byteRange: [CHUNK_SIZE - 2, CHUNK_SIZE + 1],
      }),
    )
    expect(range.equals(whole.subarray(CHUNK_SIZE - 2, CHUNK_SIZE + 2))).toBe(
      true,
    )
  })

  it('copies each byte once while assembling the cached object', async () => {
    const chunks = chunksOf(32)
    const concat = jest.spyOn(Buffer, 'concat')

    await memoryDownloadCache.set('cid', streamOf(chunks))

    const copied = concat.mock.results.reduce(
      (bytes, result) => bytes + (result.value as Buffer).length,
      0,
    )
    expect(copied).toBeLessThanOrEqual(chunks.length * CHUNK_SIZE)
  })

  it('reads an object too large to cache to the end without keeping it', async () => {
    const chunks = chunksOf(128)
    let ended = false

    await memoryDownloadCache.set(
      'cid',
      streamOf(chunks, () => {
        ended = true
      }),
    )

    expect(ended).toBe(true)
    expect(memoryDownloadCache.has('cid')).toBe(false)
  })

  it('stores an object exactly at the limit but not one byte over', async () => {
    const exact = Buffer.alloc(LIMIT, 7)

    await memoryDownloadCache.set('exact', streamOf([exact]))
    await memoryDownloadCache.set(
      'over',
      streamOf([Buffer.alloc(LIMIT), Buffer.alloc(1)]),
    )

    expect((await read(memoryDownloadCache.get('exact'))).equals(exact)).toBe(
      true,
    )
    expect(memoryDownloadCache.has('over')).toBe(false)
  })

  it('does not store an empty object', async () => {
    await memoryDownloadCache.set('cid', streamOf([Buffer.alloc(0)]))

    expect(memoryDownloadCache.has('cid')).toBe(false)
  })

  it('rejects a failed stream without caching what it read', async () => {
    async function* failing() {
      yield Buffer.alloc(CHUNK_SIZE)
      throw new Error('source failed')
    }

    await expect(memoryDownloadCache.set('cid', failing())).rejects.toThrow(
      'source failed',
    )
    expect(memoryDownloadCache.has('cid')).toBe(false)
  })
})
