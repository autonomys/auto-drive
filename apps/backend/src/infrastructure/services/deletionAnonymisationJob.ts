import { config } from '../../config.js'
import { createLogger } from '../drivers/logger.js'
import { AuthManager } from './auth/index.js'
import { DeletionUseCases } from '../../core/users/deletion.js'
import { safeCallback } from '../../shared/utils/safe.js'

const logger = createLogger('DeletionAnonymisationJob')

const runAnonymisationCheck = async (): Promise<void> => {
  logger.info('Running deletion anonymisation check')

  try {
    const dueRequests = await AuthManager.getDeletionRequestsDue()

    if (dueRequests.length === 0) {
      logger.info('No deletion requests due for anonymisation')
      return
    }

    logger.info('%d deletion request(s) due for anonymisation', dueRequests.length)

    for (const request of dueRequests) {
      await DeletionUseCases.processAnonymisation(request)
    }
  } catch (error) {
    logger.error('Failed to run anonymisation check', error)
  }

  logger.info('Deletion anonymisation check complete')
}

let anonymisationInterval: NodeJS.Timeout | null = null

const start = (): void => {
  logger.info('Starting deletion anonymisation job', {
    intervalMs: config.deletion.anonymisationCheckIntervalMs,
  })
  safeCallback(runAnonymisationCheck)()
  anonymisationInterval = setInterval(
    safeCallback(runAnonymisationCheck),
    config.deletion.anonymisationCheckIntervalMs,
  )
}

const stop = (): void => {
  logger.info('Stopping deletion anonymisation job')
  if (anonymisationInterval) {
    clearInterval(anonymisationInterval)
    anonymisationInterval = null
  }
}

export const deletionAnonymisationJob = {
  start,
  stop,
  _runAnonymisationCheck: runAnonymisationCheck,
}
