import { ObjectUseCases } from '../../../useCases/index.js'
import { AsyncDownloadsUseCases } from '../../../useCases/asyncDownloads/index.js'
import { Task } from '../tasks.js'
import { createLogger } from '../../../drivers/logger.js'
import { createHandlerWithRetries } from '../utils.js'

const logger = createLogger('eventRouter:processor:download')

export const downloadErrorPublishedQueue = 'download-errors'

export const processDownloadTask = createHandlerWithRetries(
  ({ id, params }: Task) => {
    if (id === 'async-download-created') {
      return AsyncDownloadsUseCases.asyncDownload(params.downloadId)
    } else if (id === 'object-archived') {
      return ObjectUseCases.onObjectArchived(params.cid)
    } else {
      logger.error(
        'Received task %s but no handler found (processors/download.ts)',
        id,
      )
      throw new Error(`Received task ${id} but no handler found.`)
    }
  },
  {
    errorPublishQueue: 'download-errors',
  },
)
