import { NodesUseCases } from '../../../core/objects/nodes.js'
import { ReconciliationUseCases } from '../../../core/objects/reconciliation.js'
import { PublishingRecoveryUseCases } from '../../../core/objects/publishingRecovery.js'
import { UploadsUseCases } from '../../../core/uploads/uploads.js'
import { EventRouter } from '../index.js'
import { Task } from '../tasks.js'
import { createHandlerWithRetries } from '../utils.js'
import { paymentManager } from '../../services/paymentManager/index.js'

export const frontendErrorPublishedQueue = 'frontend-errors'

export const processFrontendTask = createHandlerWithRetries(
  (task: Task) => {
    const { id, params } = task
    if (id === 'migrate-upload-nodes') {
      return UploadsUseCases.processMigration(params.uploadId)
    } else if (id === 'archive-objects') {
      return NodesUseCases.processNodeArchived(params.objects)
    } else if (id === 'publish-nodes' || id === 'ensure-object-published') {
      // Both of these sign transactions via the on-chain publisher, which now
      // runs on the dedicated publish worker (publish-manager). Two reasons they
      // must not run here: (1) on-chain confirmation takes minutes per batch and
      // would hold this fast lane's prefetch slots; (2) publishing must happen
      // in a single process because signing-account nonces are tracked in-memory
      // per process, so a second signer would collide. Forward any that still
      // arrive here (enqueued on task-manager before this routing change, or in
      // flight during a rolling deploy) rather than executing them.
      EventRouter.publish(task)
      return Promise.resolve()
    } else if (id === 'tag-upload') {
      return UploadsUseCases.tagUpload(params.cid)
    } else if (id === 'watch-intent-tx') {
      return paymentManager.watchTransaction(params.txHash)
    } else if (id === 'reconcile-archival') {
      return ReconciliationUseCases.processReconciliation()
    } else if (id === 'recover-publishing') {
      return PublishingRecoveryUseCases.processPublishingRecovery()
    } else {
      throw new Error(`Received task ${id} but no handler found.`)
    }
  },
  {
    errorPublishQueue: frontendErrorPublishedQueue,
  },
)
