import { config } from '../../config.js'
import { createLogger } from '../drivers/logger.js'
import { EventRouter } from '../eventRouter/index.js'
import { createTask } from '../eventRouter/tasks.js'
import { safeCallback } from '../../shared/utils/safe.js'
import { isTaskQueueBusy } from '../../shared/utils/queue.js'

const logger = createLogger('MigrationRecoveryJob')

let migrationRecoveryInterval: NodeJS.Timeout | null = null

const enqueueMigrationRecovery = async () => {
  if (await isTaskQueueBusy('migration recovery')) return

  logger.debug('Enqueuing recover-migrations task')
  EventRouter.publish(createTask({ id: 'recover-migrations', params: {} }))
}

const start = (): void => {
  logger.info('Starting migration recovery job', {
    intervalMs: config.migrationRecovery.intervalMs,
    maxUploadsPerCycle: config.migrationRecovery.maxUploadsPerCycle,
    stalenessMs: config.migrationRecovery.stalenessMs,
  })

  // Enqueue immediately on start to recover any already-stuck uploads
  enqueueMigrationRecovery()

  // Then periodically enqueue to catch newly stuck uploads
  migrationRecoveryInterval = setInterval(
    safeCallback(enqueueMigrationRecovery),
    config.migrationRecovery.intervalMs,
  )
}

const stop = (): void => {
  logger.info('Stopping migration recovery job')
  if (migrationRecoveryInterval) {
    clearInterval(migrationRecoveryInterval)
    migrationRecoveryInterval = null
  }
}

export const migrationRecoveryJob = {
  start,
  stop,
}
