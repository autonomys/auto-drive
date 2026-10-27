import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import { IntentsUseCases } from '../../../core/users/intents.js'
import { safeCallback } from '../../../shared/utils/safe.js'

const logger = createLogger('PaymentManager:confirmedIntents')

/**
 * Grant credits for intents that have been paid.
 *
 * Chain-independent on purpose, and the reason this is not part of the
 * per-chain watcher: it reads every CONFIRMED intent whatever asset paid for it,
 * and onConfirmedIntent is a read-then-write with no lock — it checks for
 * COMPLETED and then updates. Two of these loops running side by side would
 * both see the same freshly confirmed row and both grant its credits, which is
 * the one failure in this file that costs storage rather than time.
 *
 * So there is exactly one poller in the deployment, started once, no matter how
 * many chains are being watched.
 */
const _checkConfirmedIntents = async () => {
  logger.info('Checking confirmed intents')
  const intents = await IntentsUseCases.getConfirmedIntents()
  logger.info('Found confirmed intents', {
    intents: intents.map((intent) => intent.id),
  })
  for (const intent of intents) {
    // Per-intent, because `result.isErr()` only catches what onConfirmedIntent
    // RETURNS. A thrown exception escapes this loop entirely and is swallowed by
    // the safeCallback wrapping the interval, so one bad row stops every intent
    // behind it in the batch from being credited — and since the batch is
    // re-fetched each tick, it stops them forever, from users who paid
    // correctly, with nothing terminal written anywhere to show why.
    //
    // getIntentCredits dividing by a zero shannonsPerByte is the known way in
    // (guarded there too), but the point of this catch is the ones that are not
    // known: an intent that cannot be processed must cost its own turn, never
    // the queue's.
    try {
      const result = await IntentsUseCases.onConfirmedIntent(intent.id)

      if (result.isErr()) {
        logger.error('Error on confirmed intent', {
          intentId: intent.id,
          error: result.error,
        })
      } else {
        logger.info('Marked intent as confirmed', {
          intentId: intent.id,
        })
      }
    } catch (error) {
      logger.error('Unhandled error on confirmed intent — skipping it', {
        intentId: intent.id,
        error,
      })
    }
  }
}

let checkInterval: NodeJS.Timeout | null = null

const start = () => {
  if (checkInterval) {
    // Starting twice would double every credit grant, which is the exact race
    // this module exists to prevent. Cheap to make impossible.
    logger.warn('Confirmed-intent poller already running — ignoring start')
    return
  }
  logger.info('Starting confirmed-intent poller')
  checkInterval = setInterval(
    safeCallback(confirmedIntentsPoller._checkConfirmedIntents),
    // Named for Auto EVM because it was the only chain when it was introduced.
    // This loop touches no chain at all now, so the name is a misnomer rather
    // than a bug; kept because renaming a deployed env var costs an ops change
    // for nothing.
    config.paymentManager.checkInterval,
  )
}

const stop = () => {
  logger.info('Stopping confirmed-intent poller')
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

export const confirmedIntentsPoller = {
  start,
  stop,
  _checkConfirmedIntents,
}
