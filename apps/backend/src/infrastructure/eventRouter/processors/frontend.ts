import { NodesUseCases } from '../../../core/objects/nodes.js'
import { ReconciliationUseCases } from '../../../core/objects/reconciliation.js'
import { PublishingRecoveryUseCases } from '../../../core/objects/publishingRecovery.js'
import { UploadsUseCases } from '../../../core/uploads/uploads.js'
import { EventRouter } from '../index.js'
import { Task, createTask } from '../tasks.js'
import { createHandlerWithRetries } from '../utils.js'
import { paymentManager } from '../../services/paymentManager/index.js'

export const frontendErrorPublishedQueue = 'frontend-errors'

export const processFrontendTask = createHandlerWithRetries(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ({ id, params }: Task, _signal: AbortSignal) => {
    if (id === 'migrate-upload-nodes') {
      return UploadsUseCases.processMigration(params.uploadId)
    } else if (id === 'archive-objects') {
      return NodesUseCases.processNodeArchived(params.objects)
    } else if (id === 'publish-nodes') {
      // publish-nodes now runs on its own queue/worker (publish-manager) so its
      // multi-minute on-chain confirmation waits never block the fast tasks on
      // task-manager. A publish-nodes arriving here was enqueued on task-manager
      // before this routing change (or is in flight during a rolling deploy):
      // forward it to the dedicated queue rather than running it, so on-chain
      // publishing stays in a single process and signing-account nonces never
      // collide across workers.
      EventRouter.publish(createTask({ id, params: { nodes: params.nodes } }))
      return Promise.resolve()
    } else if (id === 'tag-upload') {
      return UploadsUseCases.tagUpload(params.cid)
    } else if (id === 'ensure-object-published') {
      return NodesUseCases.ensureObjectPublished(params.cid)
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
