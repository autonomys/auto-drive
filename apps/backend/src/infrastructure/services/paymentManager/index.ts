import { PaymentMethod } from '@auto-drive/models'
import { createLogger } from '../../drivers/logger.js'
import { ai3PaymentWatcher, usdcPaymentWatcher } from './chains.js'
import { confirmedIntentsPoller } from './confirmedIntents.js'

const logger = createLogger('PaymentManager')

/**
 * Route a tx hash to the chain it was submitted to.
 *
 * A hash on its own does not say which chain it belongs to — the two are the
 * same 32 bytes — so the intent's payment method is what decides. Defaults to
 * AI3 for callers that predate the second chain, which is also what a
 * watch-intent-tx task queued before this deployment carries.
 */
const watchTransaction = async (
  txHash: string,
  paymentMethod: PaymentMethod = PaymentMethod.AI3_NATIVE,
) => {
  if (paymentMethod === PaymentMethod.USDC_ETH) {
    if (!usdcPaymentWatcher) {
      // Reachable one way: a USDC intent was created by a deployment that had
      // Ethereum configured, and the process now handling its watch request does
      // not. Throwing keeps the task on its retry path and then in the error
      // queue, which is where a payment nobody is watching for belongs.
      throw new Error(
        `Cannot watch USDC transaction ${txHash}: this deployment has no ` +
          'Ethereum USDC configuration',
      )
    }
    return usdcPaymentWatcher.watchTransaction(txHash)
  }

  return ai3PaymentWatcher.watchTransaction(txHash)
}

/**
 * Start every payment watcher this deployment is configured for, plus the single
 * credit-granting poller.
 *
 * Must run in exactly one process. The watchers are idempotent enough to double
 * up (markIntentAsConfirmed is), but the poller is not — see
 * confirmedIntents.ts — so this is called from frontendWorker (split topology)
 * and from the all-in-one frontend server, and from nowhere else. `start:fe:api`
 * deliberately does not: it would put a second poller behind every API replica.
 */
const start = () => {
  logger.info('Starting payment manager', {
    watchers: usdcPaymentWatcher ? ['ai3', 'usdc'] : ['ai3'],
  })

  confirmedIntentsPoller.start()
  ai3PaymentWatcher.start()
  usdcPaymentWatcher?.start()
}

const stop = () => {
  logger.info('Stopping payment manager')
  usdcPaymentWatcher?.stop()
  ai3PaymentWatcher.stop()
  confirmedIntentsPoller.stop()
}

export const paymentManager = {
  start,
  stop,
  watchTransaction,
}

export {
  ai3Chain,
  ai3PaymentWatcher,
  createUsdcChain,
  usdcPaymentWatcher,
} from './chains.js'
export { confirmedIntentsPoller } from './confirmedIntents.js'
export { createPaymentWatcher } from './watcher.js'
export type {
  PaymentChain,
  PaymentRead,
  ParsedPayment,
  PaymentWatcher,
} from './watcher.js'
