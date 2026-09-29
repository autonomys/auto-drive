import { jest } from '@jest/globals'
import { Readable } from 'stream'
import { composeNodesDataAsFileReadable } from '../../../src/core/objects/files/nodeComposer.js'
import { ObjectFetcher } from '../../../src/core/objects/files/fetchers.js'
import { ChunkNotFoundError } from '../../../src/errors/index.js'

const makeFetcher = () => ({
  fetchFile: jest.fn<ObjectFetcher['fetchFile']>(),
  fetchNode: jest.fn<ObjectFetcher['fetchNode']>(),
  fetchNodes: jest.fn<ObjectFetcher['fetchNodes']>(),
})

describe('chunk stream composition', () => {
  it('rejects an unavailable first batch before returning a stream', async () => {
    const fetcher = makeFetcher()
    const error = new ChunkNotFoundError('missing')
    fetcher.fetchNodes.mockRejectedValue(error)
    await expect(
      composeNodesDataAsFileReadable({
        fetcher,
        chunks: ['first', 'missing'],
        concurrentChunks: 2,
      }),
    ).rejects.toBe(error)
  })

  it('preserves every byte across batches and backpressure, including repeated CIDs', async () => {
    const fetcher = makeFetcher()
    const chunks = ['a', 'b', 'a', 'c', 'b', 'd', 'e']
    const payload = (cid: string) => Buffer.alloc(128 * 1024, cid)
    fetcher.fetchNodes.mockImplementation(async (cids) => cids.map(payload))

    const stream = await composeNodesDataAsFileReadable({
      fetcher,
      chunks,
      concurrentChunks: 3,
    })
    // Resolving eagerly must not start fetching the entire object.
    expect(fetcher.fetchNodes.mock.calls).toEqual([[chunks.slice(0, 3)]])
    expect(stream.readableFlowing).not.toBe(true)

    const received: Buffer[] = []
    for await (const data of stream) {
      received.push(data)
      // Yield between reads so the producer encounters a paused consumer.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    expect(
      Buffer.concat(received).equals(Buffer.concat(chunks.map(payload))),
    ).toBe(true)
    expect(fetcher.fetchNodes.mock.calls).toEqual([
      [chunks.slice(0, 3)],
      [chunks.slice(3, 6)],
      [chunks.slice(6)],
    ])
  })

  it('propagates a later batch failure to the source stream consumer', async () => {
    const fetcher = makeFetcher()
    const error = new ChunkNotFoundError('later')
    fetcher.fetchNodes
      .mockResolvedValueOnce([Buffer.alloc(128 * 1024)])
      .mockRejectedValueOnce(error)
    const stream = await composeNodesDataAsFileReadable({
      fetcher,
      chunks: ['first', 'later'],
      concurrentChunks: 1,
    })
    const consume = async (source: Readable) => {
      for await (const data of source) expect(data.length).toBeGreaterThan(0)
    }
    await expect(consume(stream)).rejects.toBe(error)
    expect(stream.destroyed).toBe(true)
  })
})
