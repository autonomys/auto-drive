import { config } from '../../config.js'
import { createLogger } from '../drivers/logger.js'
import { EventRouter } from '../eventRouter/index.js'
import { createTask } from '../eventRouter/tasks.js'
import { safeCallback } from '../../shared/utils/safe.js'
import { isTaskQueueBusy } from '../../shared/utils/queue.js'

const logger = createLogger('PublishingRecoveryJob')

let publishingRecoveryInterval: NodeJS.Timeout | null = null

const enqueuePublishingRecovery = async () => {
  // Defer while either lane has a backlog: recover-publishing itself runs on
  // task-manager, and the publish-nodes it produces land on publish-manager.
  // Piling on while either is deep just grows a backlog that isn't draining
  // (e.g. while on-chain confirmations are stalled).
  const busy = await isTaskQueueBusy('publishing recovery', [
    'task-manager',
    'publish-manager',
  ])
  if (busy) return

  logger.debug('Enqueuing recover-publishing task')
  EventRouter.publish(
    createTask({ id: 'recover-publishing', params: {} }),
  )
}

const start = (): void => {
  logger.info('Starting publishing recovery job', {
    intervalMs: config.publishingRecovery.intervalMs,
    maxObjectsPerCycle: config.publishingRecovery.maxObjectsPerCycle,
  })

  // Enqueue immediately on start to recover any existing stuck objects
  enqueuePublishingRecovery()

  // Then periodically enqueue to catch newly stuck objects
  publishingRecoveryInterval = setInterval(
    safeCallback(enqueuePublishingRecovery),
    config.publishingRecovery.intervalMs,
  )
}

const stop = (): void => {
  logger.info('Stopping publishing recovery job')
  if (publishingRecoveryInterval) {
    clearInterval(publishingRecoveryInterval)
    publishingRecoveryInterval = null
  }
}

export const publishingRecoveryJob = {
  start,
  stop,
}
