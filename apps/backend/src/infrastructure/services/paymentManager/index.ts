import { PaymentMethod } from '@auto-drive/models'
import { invalidEnvironmentVariables } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import { safeCallback } from '../../../shared/utils/safe.js'
import { slackNotifier } from '../slack/index.js'
import { ai3PaymentWatcher, getUsdcPaymentWatcher } from './chains.js'
import { confirmedIntentsPoller } from './confirmedIntents.js'
import { usdcChainGuard } from './usdcChainGuard.js'

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
    // Throws on an incomplete configuration, which is the point: it lands on the
    // task's retry path and then in the error queue, with the missing variable
    // named. The null case is the deliberate one — a USDC intent exists but this
    // deployment does not accept USDC — and it belongs in the same place.
    const usdcWatcher = getUsdcPaymentWatcher()
    if (!usdcWatcher) {
      throw new Error(
        `Cannot watch USDC transaction ${txHash}: this deployment has no ` +
          'Ethereum USDC configuration',
      )
    }
    return usdcWatcher.watchTransaction(txHash)
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
 *
 * Resolving the USDC watcher here is what makes a broken payments configuration
 * fatal in the process that owns payments, and harmless in the ones that merely
 * import this module.
 */
const start = () => {
  // Said once, by the process that would have used them. An address or endpoint
  // variable set to something unusable is discarded at config load, which makes
  // the deployment behave as though USDC were switched off — safe, but baffling
  // to debug from the outside ("I set the receiver and it still refuses to
  // quote").
  //
  // Escalated as well as logged, on this PR's own argument for alerting on a
  // token mismatch: logger.error has no route to anyone, only *-errors queue
  // tasks reach Slack, and a boot line nobody reads is the same as silence. An
  // operator who meant to accept USDC and does not is worth one message. Not
  // fatal, though — the deployment is running correctly, just not selling USDC,
  // and the AI3 flow has no stake in any of these variables.
  const invalid = invalidEnvironmentVariables()
  if (invalid.length > 0) {
    logger.error(
      'Ignoring environment variables that are not valid addresses or URLs',
      { variables: invalid },
    )
    safeCallback(() =>
      slackNotifier.send({
        title:
          ':warning: USDC payment configuration was discarded — this deployment will not quote or watch USDC',
        details:
          `Set to something that is not a valid address or URL: ${invalid.join(', ')}. ` +
          'Addresses must be 20-byte hex with a 0x prefix; endpoints must be http or https URLs.',
      }),
    )()
  }

  const usdcWatcher = getUsdcPaymentWatcher()

  logger.info('Starting payment manager', {
    watchers: usdcWatcher ? ['ai3', 'usdc'] : ['ai3'],
  })

  // Ask before the watcher does, so this process's own quoting and target
  // serving fail closed on a mismatch even in the all-in-one topology, where
  // this IS the API. Memoised, so the watcher's own verifyChain reuses it.
  void usdcChainGuard.verify()

  confirmedIntentsPoller.start()
  ai3PaymentWatcher.start()
  usdcWatcher?.start()
}

const stop = () => {
  logger.info('Stopping payment manager')
  // Not resolved here: stopping a watcher that was never started is a no-op, and
  // a stop path that can throw on configuration would fail a shutdown.
  try {
    getUsdcPaymentWatcher()?.stop()
  } catch {
    // Nothing was started, so there is nothing to stop.
  }
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
  getUsdcPaymentWatcher,
  _resetUsdcPaymentWatcher,
} from './chains.js'
export { confirmedIntentsPoller } from './confirmedIntents.js'
export { createPaymentWatcher } from './watcher.js'
export type { PaymentChain, PaymentRead, ParsedPayment } from './watcher.js'
