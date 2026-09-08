import { createPublicClient, http, PublicClient } from 'viem'
import { formatUsdcBaseUnits } from '@auto-drive/models'
import { config, isUsdcConfigured } from '../../config.js'
import { UsdcPaymentsUseCases } from '../../core/payments/usdc.js'
import { createLogger } from '../drivers/logger.js'
import { sendMetricToVictoria } from '../drivers/vmetrics.js'
import { usdcPaymentStateRepository } from '../repositories/usdcPaymentState.js'
import { priceOracle } from './priceOracle/index.js'
import { safeCallback } from '../../shared/utils/safe.js'
import { slackNotifier } from './slack/index.js'

const logger = createLogger('UsdcGatesJob')

const erc20BalanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/**
 * Refreshes the two USDC gates that cannot be evaluated where they are needed:
 * the treasury's un-converted balance against its cap, and the price oracle's
 * health.
 *
 * The balance is the FX-exposure limit. USDC now accumulates and is converted to
 * AI3 by hand, so the treasury carries un-hedged USDC between a purchase and its
 * conversion; capping how much can ever be at risk is what makes manual
 * conversion safe to run, and what means nobody has to watch a balance.
 *
 * Both facts are written to `runtime_settings` rather than held in memory,
 * because the process that can observe them is not the process that quotes: an
 * API replica has no poller and would read every gate as unknown. Runs in
 * exactly one process — beside the payment watchers, started by `frontendWorker`
 * and by the all-in-one `frontend` server. See core/payments/usdc.ts.
 */

let client: PublicClient | null = null

/**
 * Its own client rather than the payment watcher's.
 *
 * The watcher exposes `_viemClient` for tests; reaching through it from
 * production code would tie this job's lifetime to a watcher's, for no benefit —
 * viem's HTTP transport is stateless and this makes one call per address per five
 * minutes.
 */
const getClient = (): PublicClient => {
  if (!client) {
    client = createPublicClient({
      transport: http(config.ethereum.rpcUrl),
    })
  }
  return client
}

/**
 * One address's USDC balance, in base units.
 *
 * Reached through the `internal` object below so a test can replace the chain
 * read without mocking viem — the same indirection the price oracle uses for its
 * subgraph query.
 */
const readBalance = (address: string): Promise<bigint> =>
  getClient().readContract({
    address: config.ethereum.usdcTokenAddress as `0x${string}`,
    abi: erc20BalanceAbi,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  })

// Grouped so unit tests can spy on the collaborators, mirroring priceOracle's
// `_internal`. Not for use outside tests — and the reason the metric goes through
// here too is mechanical: an ES module namespace is read-only, so a spy cannot be
// installed on the imported function itself.
const internal = {
  readBalance,
  readRate: () => priceOracle.getPrice(),
  sendMetric: sendMetricToVictoria,
}

/**
 * Decide the gate from a balance and the previous gate.
 *
 * Hysteretic, so it cannot be a function of the balance alone: between the
 * resume and pause thresholds the gate KEEPS its previous value, which is the
 * whole point of having two thresholds — a balance sitting exactly on one line
 * would otherwise flip the gate, and post an alert, on every poll.
 *
 * With no previous state at all, the band does not apply and the balance is
 * judged against `pause` alone — so a mid-band first reading opens. That is not
 * a softening of the cap: `pause` is the cap, the balance is under it, and
 * hysteresis exists to damp TRANSITIONS, of which a first reading has none.
 *
 * Failing closed here would be defensible on its own, and it was what this did.
 * What made it wrong is that the guess is persisted: `runCheck` writes this
 * result to `usdc_gate_readings`, so the next poll reads its own fail-closed
 * guess back as an observation and the band holds it there. Inside the band that
 * is self-perpetuating rather than merely conservative — the only exits are a
 * conversion below `resume` or an operator setting `resume = pause` — and the
 * alert that goes with it says "cap reached" for a balance under the cap.
 *
 * A missing row is reachable in practice: this feature's own down migration
 * drops `usdc_gate_readings`, so a rollback and re-apply with a mid-band balance
 * lands exactly here.
 */
export const decidePaused = (
  balance: bigint,
  previouslyPaused: boolean | null,
  // Defaulted rather than read directly so the rule can be exercised across
  // threshold pairs. The band is empty under the shipped default (resume =
  // pause), which is exactly the configuration where hysteresis cannot be
  // tested — and the band is the part worth testing.
  pause: bigint = UsdcPaymentsUseCases.getThresholds().pause,
  resume: bigint = UsdcPaymentsUseCases.getThresholds().resume,
): boolean => {
  if (balance >= pause) {
    return true
  }
  if (balance < resume) {
    return false
  }
  // Written as the `pause` comparison rather than a bare `false` so the rule is
  // legible where it is made: with nothing to damp, the gate is whatever the cap
  // says, and the cap has already been checked above.
  return previouslyPaused ?? balance >= pause
}

const describeBalance = (balance: bigint, paused: boolean) => {
  const { pause } = UsdcPaymentsUseCases.getThresholds()
  return paused
    ? `${formatUsdcBaseUnits(balance)} USDC held, cap ${formatUsdcBaseUnits(pause)}`
    : `${formatUsdcBaseUnits(balance)} USDC held, ` +
        `${formatUsdcBaseUnits(pause - balance)} of headroom`
}

/**
 * "The balance cannot be read" has no durable representation — a failed poll
 * writes nothing by design — so this is the one transition tracked in memory.
 *
 * Latched only on a SUCCESSFUL send: `slackNotifier.send` returns false rather
 * than throwing on a webhook error or a rate limit, and latching regardless
 * would lose the alert permanently while the condition persisted.
 */
let unknownAlerted = false

const alert = async (title: string, details: string): Promise<boolean> => {
  logger.warn(title, { details })
  return slackNotifier.send({ title, details })
}

/**
 * Alert on a gate TRANSITION, judged against the previous stored value.
 *
 * Durable rather than in-memory: the previous row is the same fact the
 * hysteresis reads, and it survives a restart. An in-memory memo would re-alert
 * on every restart — which, for a crash-looping worker, is the Slack storm that
 * gets the channel muted, on the channel that reports a shut payment path.
 *
 * The exception is a first-ever reading, where there is nothing to compare
 * against: a deployment that comes up healthy says nothing, one that comes up
 * already over its cap says so once.
 */
const reportBalanceTransition = async (
  paused: boolean,
  previouslyPaused: boolean | null,
  detail: string,
) => {
  if (previouslyPaused === paused) {
    return
  }

  if (previouslyPaused === null && !paused) {
    logger.info('USDC treasury within its cap', { detail })
    return
  }

  const { resume } = UsdcPaymentsUseCases.getThresholds()
  await (paused
    ? alert(
        ':warning: USDC payments auto-paused — treasury cap reached',
        `${detail}\nNo new USDC intents will be quoted until the balance is ` +
          `converted back below ${formatUsdcBaseUnits(resume)} USDC. Intents ` +
          'already quoted stay payable, and any payment that arrives is still ' +
          'credited.',
      )
    : alert(
        ':white_check_mark: USDC payments auto-resumed',
        `${detail}\nThe treasury balance is back below the resume threshold ` +
          `(${formatUsdcBaseUnits(resume)} USDC), so new USDC intents may be ` +
          'quoted again.',
      ))
}

const publishMetrics = async (
  balance: bigint | null,
  paused: boolean,
  stale: boolean,
  addressCount: number,
) => {
  const { pause } = UsdcPaymentsUseCases.getThresholds()
  // A gauge, because the alerts above can only fire once the cap has ALREADY
  // been reached. A conversion workflow run by hand needs to see the balance
  // climbing, and "the poller stopped writing" is only visible as a series going
  // flat — nothing else notices a dead worker except an operator opening the
  // admin card.
  //
  // The two amount fields are OMITTED when the balance could not be read, not
  // zeroed. Zero is a claim — "the treasury holds nothing, and there is no
  // headroom" — and it is the claim that fires a headroom alert during what is
  // actually an Ethereum outage. docs/payments.md points operators at exactly
  // these series, so the wrong value here becomes the wrong page. Omitting them
  // is also what gives the paragraph above its behaviour: the amounts go flat
  // when nobody can read them, while `stale` and `paused` keep reporting.
  await internal.sendMetric({
    measurement: 'usdc_treasury',
    tags: { environment: config.monitoring.metricEnvironmentTag },
    fields: {
      ...(balance === null
        ? {}
        : {
            balance_base_units: balance,
            headroom_base_units: pause - balance,
          }),
      cap_base_units: pause,
      paused: paused ? 1 : 0,
      stale: stale ? 1 : 0,
      address_count: addressCount,
    },
  })
}

/**
 * Refresh the oracle gate.
 *
 * Skipped while the manual gate is closed: the composite reports MANUAL_OFF
 * first, so the rate would change no decision — and each read is a billed
 * subgraph query. That makes the default-off deployment free, and it means the
 * oracle row goes stale while the switch is off, which is correct rather than
 * merely harmless: when an admin opens the switch, the gate stays closed for at
 * most one poll interval until a rate has actually been observed.
 *
 * Writes on failure as well as on success, unlike the balance. A refusal IS the
 * observation here — the oracle's guards failing closed is exactly what this gate
 * needs to know — and its reason is what the dashboard shows.
 */
const refreshOracle = async (): Promise<void> => {
  const rate = await internal.readRate()
  const health = priceOracle.getHealth()

  const reading = rate.isOk()
    ? {
        healthy: true,
        reason: null,
        servingStale: rate.value.stale,
        usdPerAi3: rate.value.usdPerAi3,
        window: health.window
          ? {
              sampleCount: health.window.sampleCount,
              buyCount: health.window.buyCount,
              sellCount: health.window.sellCount,
              volumeUsdc: health.window.volumeUsdc.toString(),
              oneSidedVolumeUsdc: health.window.oneSidedVolumeUsdc.toString(),
              poolUsdcDepth: health.window.poolUsdcDepth.toString(),
              newestSwapAt: new Date(health.window.newestSwapMs).toISOString(),
              oldestSwapAt: new Date(health.window.oldestSwapMs).toISOString(),
            }
          : null,
      }
    : {
        healthy: false,
        reason: rate.error.reason,
        servingStale: false,
        usdPerAi3: null,
        window: null,
      }

  const previous = (await usdcPaymentStateRepository.getReadings()).oracle
  await usdcPaymentStateRepository.saveOracleReading(reading)

  // Transition only, and only against a reading recent enough to have been
  // believed — same rule as the balance, and for the same reason. A refusing
  // oracle is the normal state of a pool with no liquidity, so alerting per poll
  // would post ~288 times a day.
  const wasHealthy = UsdcPaymentsUseCases.isFresh(previous)
    ? previous!.healthy
    : null
  if (wasHealthy === reading.healthy) {
    return
  }
  if (wasHealthy === null && reading.healthy) {
    return
  }

  await (reading.healthy
    ? alert(
        ':white_check_mark: USDC price oracle recovered',
        'A rate can be established again, so USDC intents may be quoted.',
      )
    : alert(
        ':warning: USDC price oracle unavailable — USDC payments closed',
        `The oracle refused to price (${reading.reason}). No new USDC intents ` +
          'will be quoted until a rate can be established. Intents already ' +
          'quoted stay payable, and any payment that arrives is still credited.',
      ))
}

const runCheck = async (): Promise<void> => {
  let addresses: string[]
  try {
    addresses = UsdcPaymentsUseCases.treasuryAddresses()
  } catch (error) {
    // An unusable USDC_TREASURY_ADDRESSES entry. Deliberately fatal to the poll
    // rather than survivable: dropping the address would count its balance as
    // zero and let the treasury exceed its cap, so the gate ages into
    // BALANCE_UNKNOWN instead and the path closes.
    logger.error(error, 'Cannot resolve treasury addresses; leaving USDC closed')
    return
  }

  if (addresses.length === 0) {
    // Unreachable through start(), which refuses to run without a configured
    // receiver, and doubly so now the receiver is always unioned in. Kept because
    // the alternative — summing an empty list to zero — would report an empty
    // treasury and hold the gate open on no evidence at all.
    logger.error(
      'No treasury addresses to poll; leaving the USDC balance gate closed',
    )
    return
  }

  const manualGate = await UsdcPaymentsUseCases.getManualGate()
  const previous = (await usdcPaymentStateRepository.getReadings()).treasury

  // The previous gate is read even from a STALE row. The balance behind it may be
  // long out of date, but the decision it recorded is still the last decision
  // made, and it is only consulted inside the hysteresis band — where the fresh
  // balance is by definition not decisive. Ignoring it there would mean a restart
  // with a mid-band balance latches the gate shut until a conversion crosses the
  // resume line, which is an outage with no cause an operator can find.
  const previouslyPaused = previous?.paused ?? null

  let balances: bigint[]
  try {
    balances = await Promise.all(
      addresses.map((address) => internal.readBalance(address)),
    )
  } catch (error) {
    // Nothing is written: a failed poll must not refresh `updated_at`, or the
    // row would never age past the max-stale window and "balance unknown" — the
    // fail-closed state — would be unreachable.
    logger.error(error, 'Failed to read the treasury USDC balance')

    if (!UsdcPaymentsUseCases.isFresh(previous) && !unknownAlerted) {
      const sent = await alert(
        ':rotating_light: USDC treasury balance unknown — failing closed',
        (previous
          ? `Last successful reading ${Math.round(
              previous.ageMs / 60_000,
            )} minutes ago (${previous.checkedAt.toISOString()}).`
          : 'No successful reading since this worker started.') +
          `\nThe balance has not been read within ${Math.round(
            config.usdcPayments.balanceMaxStaleMs / 60_000,
          )} minutes, so new USDC intents are refused: an Ethereum outage must ` +
          'not become a way to keep selling past the cap. Check the payment ' +
          'worker and ETH_CHAIN_ENDPOINT.',
      )
      unknownAlerted = sent
    }

    await publishMetrics(null, true, true, addresses.length)
    return
  }

  unknownAlerted = false

  const balance = balances.reduce((sum, value) => sum + value, 0n)
  const paused = decidePaused(balance, previouslyPaused)

  await usdcPaymentStateRepository.saveTreasuryReading({
    balanceBaseUnits: balance,
    paused,
    addresses,
  })

  logger.debug('Treasury balance polled', {
    balanceBaseUnits: balance.toString(),
    paused,
    addresses,
  })

  await reportBalanceTransition(
    paused,
    // A stale previous reading is previous state for hysteresis but NOT for
    // alerting: after an outage, saying "auto-paused" again is the honest
    // report, since nobody could have known the gate's state meanwhile.
    UsdcPaymentsUseCases.isFresh(previous) ? previouslyPaused : null,
    describeBalance(balance, paused),
  )
  await publishMetrics(balance, paused, false, addresses.length)

  if (manualGate.enabled) {
    await refreshOracle()
  }
}

let interval: NodeJS.Timeout | null = null

/**
 * Start polling, unless this deployment does not accept USDC.
 *
 * The first check runs immediately rather than after one interval: the gates fail
 * closed while their facts are unknown, so waiting five minutes after every
 * deploy would shut the purchase path for five minutes after every deploy.
 *
 * The threshold parse happens here, eagerly, and this is the only place it is
 * allowed to be fatal-ish. `core/payments/usdc.ts` deliberately does not parse at
 * import — it is reachable from the download API and the publish worker, which
 * must not crash-loop over a payments variable — so the process that owns
 * payments is where a malformed cap has to be caught. Caught rather than thrown,
 * because this process also runs uploads and credit expiry: it refuses to poll
 * (leaving the gate closed) and alerts, rather than taking those down with it.
 */
const start = (): void => {
  if (!isUsdcConfigured()) {
    logger.info('Not starting the USDC gates job: no USDC configuration')
    return
  }
  if (interval) {
    logger.warn('USDC gates job already started; ignoring')
    return
  }

  let thresholds
  let addresses
  try {
    thresholds = UsdcPaymentsUseCases.getThresholds()
    addresses = UsdcPaymentsUseCases.treasuryAddresses()
  } catch (error) {
    logger.error(
      error,
      'Refusing to start the USDC gates job on an unusable configuration; ' +
        'USDC payments stay closed',
    )
    void alert(
      ':rotating_light: USDC gates job did not start — bad configuration',
      `${error instanceof Error ? error.message : String(error)}\nUSDC ` +
        'payments will stay closed until this is fixed and the worker restarted.',
    )
    return
  }

  logger.info('Starting USDC gates job', {
    addresses,
    intervalMs: config.usdcPayments.balanceCheckIntervalMs,
    pauseThreshold: formatUsdcBaseUnits(thresholds.pause),
    resumeThreshold: formatUsdcBaseUnits(thresholds.resume),
  })

  interval = setInterval(
    safeCallback(runCheck),
    config.usdcPayments.balanceCheckIntervalMs,
  )
  void safeCallback(runCheck)()
}

const stop = (): void => {
  if (!interval) {
    return
  }
  logger.info('Stopping USDC gates job')
  clearInterval(interval)
  interval = null
}

export const usdcGatesJob = {
  start,
  stop,
  _runCheck: runCheck,
  _refreshOracle: refreshOracle,
  _internal: internal,
  // Tests only: the unknown-balance alert memo is module state, and a case that
  // asserts "alerts once" must be able to start from a known point.
  _resetAlertState: () => {
    unknownAlerted = false
  },
}
