import { config } from '../../config.js'
import { createLogger } from '../drivers/logger.js'
import { EventRouter } from '../eventRouter/index.js'
import { createTask } from '../eventRouter/tasks.js'
import { safeCallback } from '../../shared/utils/safe.js'
import { isTaskQueueBusy } from '../../shared/utils/queue.js'

const logger = createLogger('PublishingRecoveryJob')

let publishingRecoveryInterval: NodeJS.Timeout | null = null

const enqueuePublishingRecovery = async () => {
  // Defer while the fast lane is busy (recover-publishing runs on task-manager).
  if (await isTaskQueueBusy('publishing recovery')) return

  // Also defer when the publish lane is genuinely backed up. Recovery's output
  // (publish-nodes) lands on publish-manager; without this it would keep piling
  // duplicate publish tasks onto a saturated queue while confirmations are
  // stalled, growing the backlog without bound. The threshold (not > 0) lets
  // recovery still run during the shallow backlogs of normal confirmation waits.
  if (
    await isTaskQueueBusy(
      'publishing recovery',
      'publish-manager',
      config.publishingRecovery.publishManagerBacklogLimit,
    )
  ) {
    return
  }

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
