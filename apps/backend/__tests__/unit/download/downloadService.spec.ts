import { jest, describe, it, expect, afterEach } from '@jest/globals'
import { Readable, Writable } from 'stream'
import { pipeline } from 'stream/promises'
import { DownloadStatus } from '@auto-drive/models'
import { downloadService } from '../../../src/infrastructure/services/download/index.js'
import { memoryDownloadCache } from '../../../src/infrastructure/services/download/memoryDownloadCache/index.js'
import { composeNodesDataAsFileReadable } from '../../../src/core/objects/files/nodeComposer.js'
import { ObjectFetcher } from '../../../src/core/objects/files/fetchers.js'
import { ChunkNotFoundError } from '../../../src/errors/index.js'

describe('download service caching', () => {
  afterEach(async () => {
    jest.restoreAllMocks()
    await memoryDownloadCache.clear()
  })

  it('passes the object size to the memory cache', async () => {
    const set = jest.spyOn(memoryDownloadCache, 'set')
    const data = Buffer.alloc(1024, 1)

    const stream = await downloadService.handleCache(
      'download-service-size',
      {},
      Readable.from([data]),
      BigInt(data.length),
    )
    for await (const chunk of stream) expect(chunk).toBeDefined()

    expect(set).toHaveBeenCalledWith(
      'download-service-size',
      expect.anything(),
      BigInt(data.length),
    )
  })

  it('fails the response instead of stalling when a later chunk is missing, and caches nothing', async () => {
    const cid = 'download-service-mid-stream-failure'
    const chunkSize = 128 * 1024
    const error = new ChunkNotFoundError('later')
    const fetcher = {
      fetchFile: jest.fn<ObjectFetcher['fetchFile']>(),
      fetchNode: jest.fn<ObjectFetcher['fetchNode']>(),
      fetchNodes: jest
        .fn<ObjectFetcher['fetchNodes']>()
        .mockResolvedValueOnce([Buffer.alloc(chunkSize)])
        .mockRejectedValueOnce(error),
    }
    const source = await composeNodesDataAsFileReadable({
      fetcher,
      chunks: ['first', 'later'],
      concurrentChunks: 1,
    })
    const memorySet = jest.spyOn(memoryDownloadCache, 'set')
    const fsSet = jest.spyOn(downloadService.fsCache, 'set')

    const stream = await downloadService.handleCache(
      cid,
      {},
      source,
      BigInt(2 * chunkSize),
    )
    const response = new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    })

    await expect(pipeline(stream, response)).rejects.toBe(error)
    await expect(memorySet.mock.results[0]?.value).rejects.toBe(error)
    await expect(fsSet.mock.results[0]?.value).rejects.toBe(error)
    expect(await downloadService.status(cid)).toBe(DownloadStatus.NotCached)
  })
})
