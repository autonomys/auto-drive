import { OnchainPublisher } from '../../services/upload/onchainPublisher/index.js'
import { Task } from '../tasks.js'
import { createHandlerWithRetries } from '../utils.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('eventRouter:processor:publish')

export const publishErrorPublishedQueue = 'publish-errors'

// Dedicated processor for on-chain publishing. `publish-nodes` submits each
// node as a transaction and only resolves after `confirmationDepth` blocks are
// built on top (~2.5-5 min per batch, see transactionManager.ts). Running it on
// its own queue/worker keeps those long confirmation waits from holding
// task-manager prefetch slots and starving the fast frontend tasks that share
// them (migrate-upload-nodes, archive-objects, tag-upload, ...).
export const processPublishTask = createHandlerWithRetries(
  ({ id, params }: Task) => {
    if (id === 'publish-nodes') {
      return OnchainPublisher.publishNodes(params.nodes)
    } else {
      logger.error(
        'Received task %s but no handler found (processors/publish.ts)',
        id,
      )
      throw new Error(`Received task ${id} but no handler found.`)
    }
  },
  {
    errorPublishQueue: publishErrorPublishedQueue,
  },
)
