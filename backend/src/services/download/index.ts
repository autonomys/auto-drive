import { logger } from '../../drivers/logger.js'
import { FilesUseCases, ObjectUseCases } from '../../useCases/index.js'
import { memoryDownloadCache } from './memoryDownloadCache/index.js'
import { forkAsyncIterable, forkStream } from '@autonomys/asynchronous'
import {
  createFileCache,
  defaultMemoryAndSqliteConfig,
} from '@autonomys/file-caching'
import { config } from '../../config.js'
import { Readable } from 'stream'
import { DownloadStatus } from '@auto-drive/models'

const fsCache = createFileCache(
  defaultMemoryAndSqliteConfig({
    cacheMaxSize: config.cache.maxSize,
    cacheTtl: config.cache.ttl,
    dirname: config.cache.dir,
  }),
)

export const downloadService = {
  download: async (cid: string): Promise<Readable> => {
    const file = memoryDownloadCache.get(cid)
    if (file != null) {
      logger.debug('Downloading file from memory', cid)
      const [stream1, stream2] = await forkAsyncIterable(file)
      await memoryDownloadCache.set(cid, stream1)

      return stream2
    }

    const cachedFile = await fsCache.get(cid)
    if (cachedFile != null) {
      logger.debug('Reading file from file system cache', cid)
      const [stream1, stream2] = await forkStream(cachedFile.data)
      await memoryDownloadCache.set(cid, stream1)
      return stream2
    }

    const metadata = await ObjectUseCases.getMetadata(cid)
    if (!metadata) {
      throw new Error('Not found')
    }

    const data = await FilesUseCases.retrieveObject(metadata)

    const [stream1, stream2] = await forkStream(data)
    fsCache.set(cid, {
      data: stream1,
      size: metadata.totalSize,
    })
    const [stream3, stream4] = await forkStream(stream2)
    memoryDownloadCache.set(cid, stream3)

    return stream4
  },
  status: async (cid: string): Promise<DownloadStatus> => {
    const file = memoryDownloadCache.has(cid)
    if (file != null) {
      return DownloadStatus.Cached
    }

    return DownloadStatus.NotCached
  },
  fsCache,
}
