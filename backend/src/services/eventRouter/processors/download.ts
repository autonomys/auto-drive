import { ObjectUseCases } from '../../../useCases/index.js'
import { AsyncDownloadsUseCases } from '../../../useCases/asyncDownloads/index.js'
import { Task } from '../tasks.js'
import { logger } from '../../../drivers/logger.js'
import { createHandlerWithRetries } from '../utils.js'

export const processDownloadTask = createHandlerWithRetries(
  ({ id, params }: Task) => {
    if (id === 'async-download-created') {
      return AsyncDownloadsUseCases.asyncDownload(params.downloadId)
    } else if (id === 'object-archived') {
      return ObjectUseCases.onObjectArchived(params.cid)
    } else {
      logger.error(
        `Received task ${id} but no handler found. (processors/download.ts)`,
      )
      throw new Error(`Received task ${id} but no handler found.`)
    }
  },
)
