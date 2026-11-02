import { jest, describe, it, expect, afterEach } from '@jest/globals'
import { Readable } from 'stream'
import { downloadService } from '../../../src/infrastructure/services/download/index.js'
import { memoryDownloadCache } from '../../../src/infrastructure/services/download/memoryDownloadCache/index.js'

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
})
