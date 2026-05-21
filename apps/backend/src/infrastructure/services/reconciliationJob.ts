import { config } from '../../config.js'
import { createLogger } from '../drivers/logger.js'
import { EventRouter } from '../eventRouter/index.js'
import { createTask } from '../eventRouter/tasks.js'
import { safeCallback } from '../../shared/utils/safe.js'
import { isTaskQueueBusy } from '../../shared/utils/queue.js'

const logger = createLogger('ReconciliationJob')

let reconciliationInterval: NodeJS.Timeout | null = null

const enqueueReconciliation = async () => {
  if (await isTaskQueueBusy('reconciliation')) return

  logger.debug('Enqueuing reconcile-archival task')
  EventRouter.publish(
    createTask({ id: 'reconcile-archival', params: {} }),
  )
}

const start = (): void => {
  logger.info('Starting reconciliation job', {
    intervalMs: config.reconciliation.intervalMs,
  })

  // Enqueue immediately on start to drain any existing backlog
  enqueueReconciliation()

  // Then periodically enqueue as a safety net for future disconnections.
  // If the backlog is empty, processReconciliation returns quickly.
  // If there's a backlog, it self-reschedules via RabbitMQ for fast
  // draining; this interval just ensures the loop restarts if it stops.
  reconciliationInterval = setInterval(
    safeCallback(enqueueReconciliation),
    config.reconciliation.intervalMs,
  )
}

const stop = (): void => {
  logger.info('Stopping reconciliation job')
  if (reconciliationInterval) {
    clearInterval(reconciliationInterval)
    reconciliationInterval = null
  }
}

export const reconciliationJob = {
  start,
  stop,
}
