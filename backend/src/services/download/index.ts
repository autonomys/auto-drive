import { logger } from '../../drivers/logger.js'
import { FilesUseCases, ObjectUseCases } from '../../useCases/index.js'
import { memoryDownloadCache } from './memoryDownloadCache/index.js'
import { AwaitIterable } from 'interface-store'
import { fsCache } from './fsCache/singleton.js'
import { forkAsyncIterable } from '../../utils/async.js'

export const downloadService = {
  download: async (cid: string): Promise<AwaitIterable<Buffer>> => {
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
      const [stream1, stream2] = await forkAsyncIterable(cachedFile.data)
      await memoryDownloadCache.set(cid, stream1)
      return stream2
    }

    const metadata = await ObjectUseCases.getMetadata(cid)
    if (!metadata) {
      throw new Error('Not found')
    }

    const data = await FilesUseCases.retrieveObject(metadata)

    const [stream1, stream2] = await forkAsyncIterable(data)
    await fsCache.set(cid, {
      data: stream1,
      size: metadata.totalSize,
    })
    const [stream3, stream4] = await forkAsyncIterable(stream2)
    await memoryDownloadCache.set(cid, stream3)

    return stream4
  },
}
