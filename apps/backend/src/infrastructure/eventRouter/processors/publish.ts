import { OnchainPublisher } from '../../services/upload/onchainPublisher/index.js'
import { NodesUseCases } from '../../../core/objects/nodes.js'
import { Task } from '../tasks.js'
import { createHandlerWithRetries } from '../utils.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('eventRouter:processor:publish')

export const publishErrorPublishedQueue = 'publish-errors'

// Dedicated processor for on-chain publishing. Both `publish-nodes` and
// `ensure-object-published` sign transactions via the on-chain publisher and
// only resolve after `confirmationDepth` blocks build on top (~2.5-5 min per
// batch, see transactionManager.ts). Running them on their own queue/worker
// keeps those long confirmation waits from holding task-manager prefetch slots
// and starving the fast frontend tasks (migrate-upload-nodes, archive-objects,
// tag-upload, ...). They share this single worker so signing-account nonces
// (tracked in-memory per process) never collide across processes.
export const processPublishTask = createHandlerWithRetries(
  ({ id, params }: Task) => {
    if (id === 'publish-nodes') {
      return OnchainPublisher.publishNodes(params.nodes)
    } else if (id === 'ensure-object-published') {
      return NodesUseCases.ensureObjectPublished(params.cid)
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
