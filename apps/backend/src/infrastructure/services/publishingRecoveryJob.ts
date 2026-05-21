import { config } from '../../config.js'
import { createLogger } from '../drivers/logger.js'
import { Rabbit } from '../drivers/rabbit.js'
import { EventRouter } from '../eventRouter/index.js'
import { createTask } from '../eventRouter/tasks.js'
import { safeCallback } from '../../shared/utils/safe.js'

const logger = createLogger('PublishingRecoveryJob')

const TASK_MANAGER_QUEUE = 'task-manager'

let publishingRecoveryInterval: NodeJS.Timeout | null = null

const isQueueBusy = async (): Promise<boolean> => {
  try {
    const pending = await Rabbit.getMessageCount(TASK_MANAGER_QUEUE)
    if (pending > 0) {
      logger.debug(
        'Deferring publishing recovery, %d tasks pending in queue',
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

const enqueuePublishingRecovery = async () => {
  if (await isQueueBusy()) return

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
