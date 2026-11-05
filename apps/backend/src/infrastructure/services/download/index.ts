import { createLogger } from '../../drivers/logger.js'
import { FilesUseCases } from '../../../core/objects/files/index.js'
import { ObjectUseCases } from '../../../core/objects/object.js'
import { memoryDownloadCache } from './memoryDownloadCache/index.js'
import { forkAsyncIterable, forkStream } from '@autonomys/asynchronous'
import {
  createFileCache,
  defaultMemoryAndSqliteConfig,
} from '@autonomys/file-server'
import { config } from '../../../config.js'
import { Readable } from 'stream'
import { DownloadServiceOptions, DownloadStatus } from '@auto-drive/models'
import {
  handleReadableError,
  withInactivityTimeout,
} from '../../../shared/utils/index.js'

const logger = createLogger('download-service')

const fsCache = createFileCache(
  defaultMemoryAndSqliteConfig({
    cacheMaxSize: config.cache.maxSize,
    cacheTtl: config.cache.ttl,
    dirname: config.cache.dir,
  }),
)

// Full retrievals from the source that are still filling the caches, by CID. A
// later request for the same CID waits for the entry and then reads the caches,
// so overlapping requests cost one retrieval. An entry settles once both cache
// writes have, and rejects with the retrieval's error.
const inFlightRetrievals = new Map<string, Promise<void>>()

const getFromCaches = async (
  cid: string,
  options: DownloadServiceOptions,
): Promise<Readable | null> => {
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

  return null
}

const retrieveFromSource = async (
  cid: string,
  options: DownloadServiceOptions,
) => {
  const getMetadataResult = await ObjectUseCases.getMetadata(cid)
  if (getMetadataResult.isErr()) {
    throw new Error('Not found')
  }
  const metadata = getMetadataResult.value

  const data = await FilesUseCases.retrieveObject(metadata, options)

  return { data, size: BigInt(metadata.totalSize) }
}

const forkIntoCaches = async (
  cid: string,
  stream: Readable | AsyncIterable<Buffer>,
  size: bigint | undefined,
): Promise<{ response: Readable; cached: Promise<void> }> => {
  handleReadableError(stream, 'Source stream error for cid %s', cid)

  const [response, cacheStream] =
    stream instanceof Readable
      ? await forkStream(stream)
      : await forkAsyncIterable(stream)

  handleReadableError(cacheStream, 'Cache branch stream error for cid %s', cid)

  const cached = forkStream(cacheStream).then(
    async ([fsCacheStream, memoryCacheStream]) => {
      handleReadableError(
        fsCacheStream,
        'Filesystem cache stream error for cid %s',
        cid,
      )
      handleReadableError(
        memoryCacheStream,
        'Memory cache stream error for cid %s',
        cid,
      )
      const [memoryResult, fsResult] = await Promise.allSettled([
        memoryDownloadCache.set(cid, memoryCacheStream, size),
        fsCache.set(cid, { data: fsCacheStream, size }),
      ])
      if (fsResult.status === 'rejected') {
        logger.warn(
          'Error setting filesystem cache for cid %s',
          cid,
          fsResult.reason,
        )
      }
      if (memoryResult.status === 'rejected') {
        logger.warn(
          'Error setting memory cache for cid %s',
          cid,
          memoryResult.reason,
        )
        // The memory cache reads its branch to the end whatever the size, so
        // it fails only when the stream itself does.
        throw memoryResult.reason
      }
    },
  )

  return { response, cached }
}

const startSharedRetrieval = async (cid: string): Promise<Readable> => {
  const retrieval = (async () => {
    const { data, size } = await retrieveFromSource(cid, {})
    const guarded = withInactivityTimeout(
      data,
      config.params.downloadInactivityTimeoutMs,
      `Retrieval of cid ${cid} stalled: no data received for ${
        config.params.downloadInactivityTimeoutMs / 1000
      }s`,
    )
    return forkIntoCaches(cid, guarded, size)
  })()
  const cached = retrieval.then(({ cached }) => cached)

  inFlightRetrievals.set(cid, cached)
  const forget = () => {
    if (inFlightRetrievals.get(cid) === cached) {
      inFlightRetrievals.delete(cid)
    }
  }
  cached.then(forget, forget)

  const { response } = await retrieval
  return response
}

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
    const cached = await getFromCaches(cid, options)
    if (cached != null) {
      return cached
    }

    if (options.byteRange) {
      const { data, size } = await retrieveFromSource(cid, options)
      return downloadService.handleCache(cid, options, data, size)
    }

    const inFlight = inFlightRetrievals.get(cid)
    if (inFlight == null) {
      return startSharedRetrieval(cid)
    }

    logger.info('Waiting for the in-flight retrieval of cid %s', cid)
    await inFlight
    return downloadService.download(cid, options)
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
      const streamToReturn =
        stream instanceof Readable ? stream : Readable.from(stream)
      handleReadableError(
        streamToReturn,
        'Byte range stream error for cid %s',
        cid,
      )
      return streamToReturn
    }

    const { response, cached } = await forkIntoCaches(cid, stream, size)
    cached.catch(() => {})

    return response
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
