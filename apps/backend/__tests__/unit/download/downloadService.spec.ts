import { jest, describe, it, expect, afterEach } from '@jest/globals'
import { PassThrough, Readable, Writable } from 'stream'
import { pipeline } from 'stream/promises'
import { ok } from 'neverthrow'
import { v4 } from 'uuid'
import { DownloadStatus } from '@auto-drive/models'
import { downloadService } from '../../../src/infrastructure/services/download/index.js'
import { memoryDownloadCache } from '../../../src/infrastructure/services/download/memoryDownloadCache/index.js'
import { composeNodesDataAsFileReadable } from '../../../src/core/objects/files/nodeComposer.js'
import { ObjectFetcher } from '../../../src/core/objects/files/fetchers.js'
import { FilesUseCases } from '../../../src/core/objects/files/index.js'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { ChunkNotFoundError } from '../../../src/errors/index.js'
import { config } from '../../../src/config.js'

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

describe('download service single retrieval per CID', () => {
  const data = Buffer.from('bytes retrieved from the source')

  afterEach(async () => {
    jest.restoreAllMocks()
    await memoryDownloadCache.clear()
  })

  const readAll = async (stream: Readable) =>
    Buffer.concat(await stream.toArray())

  // The first retrieval reads from `source`; any later one gets a fresh copy of
  // `data`, so a test that expects a single retrieval fails on the call count
  // rather than hanging.
  const mockSource = (cid: string, source: Readable) => {
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(
        ok({ dataCid: cid, type: 'file', totalSize: data.length } as never),
      )
    const sources = [source]
    const retrieveObject = jest
      .spyOn(FilesUseCases, 'retrieveObject')
      .mockImplementation(async () => sources.shift() ?? Readable.from([data]))
    const fsGet = jest.spyOn(downloadService.fsCache, 'get')

    // Lets every download started so far finish its cache lookups and reach
    // the in-flight check.
    const settleCacheLookups = async () => {
      await Promise.allSettled(fsGet.mock.results.map((r) => r.value))
      await new Promise((resolve) => setImmediate(resolve))
    }

    return { retrieveObject, settleCacheLookups }
  }

  it('serves overlapping full downloads from one retrieval', async () => {
    const cid = `single-flight-${v4()}`
    const source = new PassThrough()
    const { retrieveObject, settleCacheLookups } = mockSource(cid, source)

    const first = await downloadService.download(cid)
    const later = [downloadService.download(cid), downloadService.download(cid)]
    await settleCacheLookups()
    source.end(data)

    expect(await readAll(first)).toEqual(data)
    for (const stream of await Promise.all(later)) {
      expect(await readAll(stream)).toEqual(data)
    }
    expect(retrieveObject).toHaveBeenCalledTimes(1)
  })

  it('keeps one retrieval when the requests arrive together', async () => {
    const cid = `single-flight-together-${v4()}`
    const source = new PassThrough()
    const { retrieveObject, settleCacheLookups } = mockSource(cid, source)

    const downloads = [
      downloadService.download(cid),
      downloadService.download(cid),
      downloadService.download(cid),
    ]
    await settleCacheLookups()
    source.end(data)

    for (const stream of await Promise.all(downloads)) {
      expect(await readAll(stream)).toEqual(data)
    }
    expect(retrieveObject).toHaveBeenCalledTimes(1)
  })

  it('finishes the retrieval for later requests after the first client leaves', async () => {
    const cid = `single-flight-abandoned-${v4()}`
    const source = new PassThrough()
    const { retrieveObject, settleCacheLookups } = mockSource(cid, source)

    const preview = await downloadService.download(cid)
    preview.destroy()
    const later = downloadService.download(cid)
    await settleCacheLookups()
    source.end(data)

    expect(await readAll(await later)).toEqual(data)
    expect(await downloadService.status(cid)).toBe(DownloadStatus.Cached)
    expect(retrieveObject).toHaveBeenCalledTimes(1)
  })

  it('does not hold byte-range requests behind an in-flight retrieval', async () => {
    const cid = `single-flight-range-${v4()}`
    const source = new PassThrough()
    const { retrieveObject } = mockSource(cid, source)

    const full = await downloadService.download(cid)
    const ranged = await downloadService.download(cid, { byteRange: [0, 4] })

    expect(retrieveObject).toHaveBeenCalledTimes(2)
    expect(retrieveObject).toHaveBeenLastCalledWith(expect.anything(), {
      byteRange: [0, 4],
    })
    expect(await readAll(ranged)).toEqual(data)
    source.end(data)
    expect(await readAll(full)).toEqual(data)
  })

  it('fails waiting requests with the retrieval error, then retrieves afresh', async () => {
    const cid = `single-flight-failure-${v4()}`
    const source = new PassThrough()
    const { retrieveObject, settleCacheLookups } = mockSource(cid, source)
    const error = new Error('gateway went away')

    const first = await downloadService.download(cid)
    const later = downloadService.download(cid)
    const laterFails = expect(later).rejects.toBe(error)
    await settleCacheLookups()
    source.destroy(error)

    await expect(readAll(first)).rejects.toBe(error)
    await laterFails
    expect(retrieveObject).toHaveBeenCalledTimes(1)

    expect(await readAll(await downloadService.download(cid))).toEqual(data)
    expect(retrieveObject).toHaveBeenCalledTimes(2)
  })

  it('fails a retrieval that stops producing data, without timing its start', async () => {
    const cid = `single-flight-stall-${v4()}`
    const source = new PassThrough()
    const { settleCacheLookups } = mockSource(cid, source)
    jest.replaceProperty(config.params, 'downloadInactivityTimeoutMs', 50)

    const first = await downloadService.download(cid)
    const later = downloadService.download(cid)
    let laterSettled = false
    later.then(
      () => (laterSettled = true),
      () => (laterSettled = true),
    )
    await settleCacheLookups()

    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(laterSettled).toBe(false)

    source.write(data.subarray(0, 5))
    await expect(later).rejects.toThrow('stalled: no data received')
    await expect(readAll(first)).rejects.toThrow('stalled: no data received')
    expect(source.destroyed).toBe(true)
  })

  it('fails waiting requests when the first response stops being read after the source ends', async () => {
    const cid = `single-flight-unread-${v4()}`
    const source = new PassThrough()
    const { settleCacheLookups } = mockSource(cid, source)
    jest.replaceProperty(config.params, 'downloadInactivityTimeoutMs', 50)

    const unread = await downloadService.download(cid)
    const later = downloadService.download(cid)
    await settleCacheLookups()
    for (let i = 0; i < 3; i++) {
      source.write(Buffer.alloc(8 * 1024, i))
    }
    source.end()

    await expect(later).rejects.toThrow('stalled: no data received')
    expect(unread.destroyed).toBe(true)
  })
})
