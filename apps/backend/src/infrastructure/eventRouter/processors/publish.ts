import { OnchainPublisher } from '../../services/upload/onchainPublisher/index.js'
import { NodesUseCases } from '../../../core/objects/nodes.js'
import { Task } from '../tasks.js'
import { createHandlerWithRetries } from '../utils.js'
import { createLogger } from '../../drivers/logger.js'
import { config } from '../../../config.js'

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
//
// `ensure-object-published` has no active producer today (nothing enqueues it —
// see tasks.ts / eventRouter routing); it is handled here defensively so that
// if it is ever emitted it lands on the single signer rather than the fast lane.
//
// taskTimeoutMs is the backstop for the perpetual-re-inclusion deadlock: without
// it a handler that never returns would pin a prefetch slot forever (see
// config.publishing.taskTimeoutMs). On timeout createHandlerWithRetries aborts
// the signal we forward into the publisher, which tears down the in-flight
// signAndSend / confirmation-watch subscriptions before the task retries on
// publish-manager — so a permanent stall degrades to a bounded retry without
// leaking orphaned watches that would otherwise multiply across retries.
export const processPublishTask = createHandlerWithRetries(
  ({ id, params }: Task, signal: AbortSignal) => {
    if (id === 'publish-nodes') {
      return OnchainPublisher.publishNodes(params.nodes, signal)
    } else if (id === 'ensure-object-published') {
      return NodesUseCases.ensureObjectPublished(params.cid, signal)
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
    taskTimeoutMs: config.publishing.taskTimeoutMs,
  },
)
