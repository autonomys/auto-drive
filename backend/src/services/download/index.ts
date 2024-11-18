import PizZip from 'pizzip'
import { FilesUseCases, ObjectUseCases } from '../../useCases/index.js'
import { databaseDownloadCache } from './databaseDownloadCache/index.js'
import { memoryDownloadCache } from './memoryDownloadCache/index.js'

export const downloadService = {
  download: async (cid: string) => {
    if (memoryDownloadCache.has(cid)) {
      console.log('Downloading file from memory', cid)
      return memoryDownloadCache.get(cid)!
    }

    if (await databaseDownloadCache.has(cid)) {
      console.log('Downloading file from database', cid)
      return databaseDownloadCache.get(cid)!
    }

    const metadata = await ObjectUseCases.getMetadata(cid)
    if (!metadata) {
      throw new Error('Not found')
    }
    console.log('Downloading file', cid)

    if (metadata.type === 'folder') {
      return FilesUseCases.retrieveAndReassembleFolderAsZip(new PizZip(), cid)
    }

    const data = FilesUseCases.retrieveAndReassembleFile(metadata)

    return data
  },
}
