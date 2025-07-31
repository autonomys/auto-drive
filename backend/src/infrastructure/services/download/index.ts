import { createLogger } from '../../drivers/logger.js'
import { FilesUseCases } from '../../../core/objects/files/index.js'
import { ObjectUseCases } from '../../../core/objects/object.js'
import { memoryDownloadCache } from './memoryDownloadCache/index.js'
import { forkAsyncIterable, forkStream } from '@autonomys/asynchronous'
import {
  createFileCache,
  defaultMemoryAndSqliteConfig,
} from '@autonomys/file-caching'
import { config } from '../../../config.js'
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
    options: DownloadServiceOptions = {},
  ): Promise<Readable> => {
    logger.debug(
      `Download service called for cid=${cid} with options=${JSON.stringify(
        options,
      )}`,
    )
    const file = memoryDownloadCache.get(cid, options)
    if (file != null) {
      logger.debug('Downloading file from memory %s', cid)

      return downloadService.handleCache(cid, options, file, undefined)
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
      return downloadService.handleCache(
        cid,
        options,
        cachedFile.data,
        cachedFile.size,
      )
    }

    const getMetadataResult = await ObjectUseCases.getMetadata(cid)
    if (getMetadataResult.isErr()) {
      throw new Error('Not found')
    }
    const metadata = getMetadataResult.value

    const data = await FilesUseCases.retrieveObject(metadata, options)

    return downloadService.handleCache(
      cid,
      options,
      data,
      BigInt(metadata.totalSize),
    )
  },
  handleCache: async (
    cid: string,
    options: DownloadServiceOptions,
    stream: Readable | AsyncIterable<Buffer>,
    size: bigint | undefined,
  ): Promise<Readable> => {
    logger.debug(
      `Populating caches for cid=${cid} with options=${JSON.stringify(options)}`,
    )

    // If byte range is set, don't cache and return the stream directly
    if (options?.byteRange) {
      return stream instanceof Readable ? stream : Readable.from(stream)
    }

    // Fork the stream once for caching and return
    const [returnStream, cacheStream] =
      stream instanceof Readable
        ? await forkStream(stream)
        : await forkAsyncIterable(stream)

    // Fork the stream again for caching w/o blocking the main thread
    forkStream(cacheStream).then(async ([fsCacheStream, memoryCacheStream]) => {
      await memoryDownloadCache.set(cid, memoryCacheStream)
      await fsCache.set(cid, { data: fsCacheStream, size })
    })

    return returnStream
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
