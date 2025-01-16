import { logger } from '../../drivers/logger.js'
import { FilesUseCases, ObjectUseCases } from '../../useCases/index.js'
import { databaseDownloadCache } from './databaseDownloadCache/index.js'
import { memoryDownloadCache } from './memoryDownloadCache/index.js'
import { AwaitIterable } from 'interface-store'

export const downloadService = {
  download: async (cid: string): Promise<AwaitIterable<Buffer>> => {
    if (memoryDownloadCache.has(cid)) {
      logger.debug('Downloading file from memory', cid)
      return memoryDownloadCache.get(cid)!
    }

    if (await databaseDownloadCache.has(cid)) {
      logger.debug('Downloading file from database', cid)
      let data = databaseDownloadCache.get(cid)!
      data = memoryDownloadCache.set(cid, data)
      return data
    }

    const metadata = await ObjectUseCases.getMetadata(cid)
    if (!metadata) {
      throw new Error('Not found')
    }

    let data = await FilesUseCases.retrieveObject(metadata)

    data = await databaseDownloadCache.set(cid, data, metadata.totalSize)

    data = memoryDownloadCache.set(cid, data)

    return data
  },
}
