import { OnchainPublisher } from '../../upload/onchainPublisher/index.js'
import { NodesUseCases } from '../../../useCases/objects/nodes.js'
import { UploadsUseCases } from '../../../useCases/uploads/uploads.js'
import { Task } from '../tasks.js'
import { createHandlerWithRetries } from '../utils.js'

export const frontendErrorPublishedQueue = 'frontend-errors'

export const processFrontendTask = createHandlerWithRetries(
  ({ id, params, retriesLeft }: Task) => {
    if (id === 'migrate-upload-nodes') {
      return UploadsUseCases.processMigration(params.uploadId)
    } else if (id === 'archive-objects') {
      return NodesUseCases.processNodeArchived(params.objects)
    } else if (id === 'publish-nodes') {
      return OnchainPublisher.publishNodes(params.nodes, retriesLeft)
    } else if (id === 'tag-upload') {
      return UploadsUseCases.tagUpload(params.cid)
    } else {
      throw new Error(`Received task ${id} but no handler found.`)
    }
  },
  {
    errorPublishQueue: frontendErrorPublishedQueue,
  },
)
