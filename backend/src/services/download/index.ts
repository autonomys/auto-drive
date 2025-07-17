import { createLogger } from '../../drivers/logger.js'
import { FilesUseCases, ObjectUseCases } from '../../useCases/index.js'
import { memoryDownloadCache } from './memoryDownloadCache/index.js'
import { forkAsyncIterable, forkStream } from '@autonomys/asynchronous'
import {
  createFileCache,
  defaultMemoryAndSqliteConfig,
} from '@autonomys/file-caching'
import { config } from '../../config.js'
import { Readable } from 'stream'
import { DownloadServiceOptions, DownloadStatus } from '@auto-drive/models'

const logger = createLogger('download-service')

const fsCache = createFileCache(
  defaultMemoryAndSqliteConfig({
    cacheMaxSize: config.cache.maxSize,
    cacheTtl: config.cache.ttl,
    dirname: config.cache.dir,
  }),
)

export const downloadService = {
  download: async (
    cid: string,
    options?: DownloadServiceOptions,
  ): Promise<Readable> => {
    const file = memoryDownloadCache.get(cid, options)
    if (file != null) {
      logger.debug('Downloading file from memory %s', cid)
      const [stream1, stream2] = await forkAsyncIterable(file)

      // Cache the file in the file system cache
      if (!options?.byteRange) {
        ObjectUseCases.getMetadata(cid).then(async (metadata) => {
          const [stream3, stream4] = await forkStream(stream1)
          fsCache.set(cid, {
            data: stream3,
            size: BigInt(metadata?.totalSize ?? 0).valueOf(),
          })
          memoryDownloadCache.set(cid, stream4)
        })
      }

      return stream2
    }

    const cachedFile = await fsCache.get(cid, options).catch((e) => {
      logger.error(
        e as Error,
        'Error getting file from file system cache for cid %s. Ignoring error and retrieving file from source.',
        cid,
      )
      return null
    })
    if (cachedFile != null) {
      logger.debug('Reading file from file system cache %s', cid)
      const [stream1, stream2] = await forkStream(cachedFile.data)
      if (!options?.byteRange) {
        memoryDownloadCache.set(cid, stream1)
      }
      return stream2
    }

    const metadata = await ObjectUseCases.getMetadata(cid)
    if (!metadata) {
      throw new Error('Not found')
    }

    const data = await FilesUseCases.retrieveObject(metadata, options)

    const [returningStream, stream2] = await forkStream(data)

    forkStream(stream2).then(([stream3, stream4]) => {
      memoryDownloadCache.set(cid, stream3)
      fsCache.set(cid, {
        data: stream4,
        size: BigInt(metadata.totalSize).valueOf(),
      })
    })

    return returningStream
  },
  status: async (cid: string): Promise<DownloadStatus> => {
    const file = memoryDownloadCache.has(cid)
    if (file) {
      return DownloadStatus.Cached
    }

    const cachedFile = await fsCache.has(cid)
    if (cachedFile) {
      return DownloadStatus.Cached
    }

    return DownloadStatus.NotCached
  },
  fsCache,
}
