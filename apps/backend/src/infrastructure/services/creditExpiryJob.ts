import { config } from '../../config.js'
import { createLogger } from '../drivers/logger.js'
import { purchasedCreditsRepository } from '../repositories/users/purchasedCredits.js'
import { IntentsUseCases } from '../../core/users/intents.js'
import { safeCallback } from '../../shared/utils/safe.js'

const logger = createLogger('CreditExpiryJob')

// Runs one expiry check cycle:
//  1. Mark purchased_credits rows whose expires_at has passed.
//  2. Mark PENDING intents whose price-lock window has passed.
const runExpiryCheck = async (): Promise<void> => {
  logger.info('Running credit expiry check')

  const forfeited = await purchasedCreditsRepository.markExpiredCredits()
  if (
    forfeited.totalUploadBytesForfeited > 0n ||
    forfeited.totalDownloadBytesForfeited > 0n
  ) {
    logger.info('Forfeited expired purchased credits', {
      uploadBytes: forfeited.totalUploadBytesForfeited.toString(),
      downloadBytes: forfeited.totalDownloadBytesForfeited.toString(),
      rows: forfeited.expiredCount,
    })
  }

  await IntentsUseCases.cleanupExpiredIntents()

  logger.info('Credit expiry check complete')
}

let expiryInterval: NodeJS.Timeout | null = null

const start = (): void => {
  logger.info('Starting credit expiry job', {
    intervalMs: config.credits.expiryCheckIntervalMs,
  })
  expiryInterval = setInterval(
    safeCallback(runExpiryCheck),
    config.credits.expiryCheckIntervalMs,
  )
}

const stop = (): void => {
  logger.info('Stopping credit expiry job')
  if (expiryInterval) {
    clearInterval(expiryInterval)
    expiryInterval = null
  }
}

export const creditExpiryJob = {
  start,
  stop,
  _runExpiryCheck: runExpiryCheck,
}
