import { config } from '../../config.js'
import { createLogger } from '../drivers/logger.js'
import { Rabbit } from '../drivers/rabbit.js'
import { EventRouter } from '../eventRouter/index.js'
import { createTask } from '../eventRouter/tasks.js'
import { safeCallback } from '../../shared/utils/safe.js'

const logger = createLogger('ReconciliationJob')

const TASK_MANAGER_QUEUE = 'task-manager'

let reconciliationInterval: NodeJS.Timeout | null = null

const isQueueBusy = async (): Promise<boolean> => {
  try {
    const pending = await Rabbit.getMessageCount(TASK_MANAGER_QUEUE)
    if (pending > 0) {
      logger.debug(
        'Deferring reconciliation, %d tasks pending in queue',
        pending,
      )
      return true
    }
  } catch (error) {
    logger.warn(
      'Failed to check queue depth, proceeding: %s',
      error instanceof Error ? error.message : String(error),
    )
  }
  return false
}

const enqueueReconciliation = async () => {
  if (await isQueueBusy()) return

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
