import { createPublicClient, http, PublicClient } from 'viem'
import { config, isUsdcConfigured } from '../../config.js'
import {
  TreasurySnapshot,
  UsdcPaymentsUseCases,
  pauseThresholdBaseUnits,
  resumeThresholdBaseUnits,
} from '../../core/payments/usdc.js'
import { createLogger } from '../drivers/logger.js'
import {
  RuntimeSettingKey,
  runtimeSettingsRepository,
} from '../repositories/runtimeSettings.js'
import { formatUsdcBaseUnits } from '../../shared/utils/index.js'
import { safeCallback } from '../../shared/utils/safe.js'
import { slackNotifier } from './slack/index.js'

const logger = createLogger('UsdcTreasuryBalanceJob')

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
 * The treasury's un-converted USDC, polled and persisted.
 *
 * This is the FX-exposure limit: USDC now accumulates and is converted to AI3 by
 * hand, so the treasury carries un-hedged USDC between a purchase and its
 * conversion. Capping how much can ever be at risk is what makes manual
 * conversion safe to run, and what means nobody has to watch a balance.
 *
 * Runs in exactly one process — beside the payment watchers, started by
 * `frontendWorker` and by the all-in-one `frontend` server. The result is
 * written to `runtime_settings` rather than held in memory because the process
 * that quotes USDC is a different one entirely: an API replica has no poller and
 * would read every gate as unknown. See core/payments/usdc.ts.
 */

// Reported state, for alerting only. Held in memory because it exists to answer
// "has this changed since I last said something", and the answer after a restart
// should be "I do not know" — one repeated alert on a genuinely bad state is a
// better failure than silence.
type ReportedState = 'open' | 'paused' | 'unknown'
let lastReported: ReportedState | null = null

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

// Grouped so unit tests can spy on the collaborator, mirroring priceOracle's
// `_internal`. Not for use outside tests.
const internal = { readBalance }

/**
 * Decide the gate from a balance and the previous gate.
 *
 * Hysteretic, so it cannot be a function of the balance alone: between the
 * resume and pause thresholds the gate KEEPS its previous value, which is the
 * whole point of having two thresholds — a balance sitting exactly on one line
 * would otherwise flip the gate, and post an alert, on every poll.
 *
 * With no previous state (a first poll, or a reading too old to trust) a balance
 * inside the band fails closed. "No evidence the cap was respected" is not the
 * same as "the cap is respected", and this is the direction where being wrong
 * costs an unquoted purchase rather than un-hedged USDC.
 */
export const decidePaused = (
  balance: bigint,
  previouslyPaused: boolean | null,
  // Defaulted rather than read directly so the rule can be exercised across
  // threshold pairs. The band is empty under the shipped default (resume =
  // pause), which is exactly the configuration where hysteresis cannot be
  // tested — and the band is the part worth testing.
  pause: bigint = pauseThresholdBaseUnits,
  resume: bigint = resumeThresholdBaseUnits,
): boolean => {
  if (balance >= pause) {
    return true
  }
  if (balance < resume) {
    return false
  }
  return previouslyPaused ?? true
}

const describe = (balance: bigint, paused: boolean) =>
  paused
    ? `${formatUsdcBaseUnits(balance)} USDC held, cap ` +
      `${formatUsdcBaseUnits(pauseThresholdBaseUnits)}`
    : `${formatUsdcBaseUnits(balance)} USDC held, ` +
      `${formatUsdcBaseUnits(pauseThresholdBaseUnits - balance)} of headroom`

/**
 * Alert on a state CHANGE only.
 *
 * A poll every five minutes that alerted on every result would post ~288 times a
 * day, and the first thing anyone would do is mute the channel — which is the
 * one outcome that must not happen to the alert that says the payment path is
 * shut.
 *
 * The exception is the first observation after a start: nothing is reported when
 * all is well, but a deployment that comes up already paused (or unable to read
 * the balance at all) says so once.
 */
const report = async (state: ReportedState, detail: string) => {
  if (lastReported === state) {
    return
  }
  const first = lastReported === null
  lastReported = state

  if (first && state === 'open') {
    logger.info('USDC treasury within its cap', { detail })
    return
  }

  const message = {
    open: {
      title: ':white_check_mark: USDC payments auto-resumed',
      details:
        `${detail}\nThe treasury balance is back below the resume threshold ` +
        `(${formatUsdcBaseUnits(resumeThresholdBaseUnits)} USDC), so new USDC ` +
        'intents may be quoted again.',
    },
    paused: {
      title: ':warning: USDC payments auto-paused — treasury cap reached',
      details:
        `${detail}\nNo new USDC intents will be quoted until the balance is ` +
        'converted back below the resume threshold. Intents already quoted stay ' +
        'payable, and any payment that arrives is still credited.',
    },
    unknown: {
      title: ':rotating_light: USDC treasury balance unknown — failing closed',
      details:
        `${detail}\nThe balance has not been read successfully within ` +
        `${Math.round(config.usdcPayments.balanceMaxStaleMs / 60_000)} minutes, ` +
        'so new USDC intents are refused: an Ethereum outage must not become a ' +
        'way to keep selling past the cap. Check the payment worker and ' +
        'ETH_CHAIN_ENDPOINT.',
    },
  }[state]

  logger.warn(message.title, { detail })
  await slackNotifier.send(message)
}

const runCheck = async (): Promise<void> => {
  // Through the use-case object rather than the named import, like
  // getTreasuryState below: one seam for the whole collaboration, and a spy on
  // it patches what this actually calls.
  const addresses = UsdcPaymentsUseCases.treasuryAddresses()
  if (addresses.length === 0) {
    // Unreachable through start(), which refuses to run without a configured
    // receiver. Kept because the alternative — summing an empty list to zero —
    // would report an empty treasury and hold the gate open on no evidence at
    // all.
    logger.error(
      'No treasury addresses to poll; leaving the USDC balance gate closed',
    )
    return
  }

  const previous = await UsdcPaymentsUseCases.getTreasuryState()
  // A reading too old to trust is not a previous state for hysteresis purposes:
  // the balance may have moved anywhere since.
  const previouslyPaused =
    previous.snapshot && !previous.stale ? previous.snapshot.paused : null

  let balances: bigint[]
  try {
    balances = await Promise.all(
      addresses.map((address) => internal.readBalance(address)),
    )
  } catch (error) {
    // Nothing is written: a failed poll must not refresh `updated_at`, or the
    // row would never age past the max-stale window and "balance unknown" — the
    // fail-closed state — would be unreachable.
    logger.error('Failed to read the treasury USDC balance', error)
    if (!previous.snapshot || previous.stale) {
      await report(
        'unknown',
        previous.checkedAt
          ? `Last successful reading ${Math.round(
              (previous.ageMs ?? 0) / 60_000,
            )} minutes ago (${previous.checkedAt.toISOString()}).`
          : 'No successful reading since this worker started.',
      )
    }
    return
  }

  const balance = balances.reduce((sum, value) => sum + value, 0n)
  const paused = decidePaused(balance, previouslyPaused)

  const snapshot: TreasurySnapshot = {
    balanceBaseUnits: balance.toString(),
    paused,
    addresses,
  }
  await runtimeSettingsRepository.set<TreasurySnapshot>(
    RuntimeSettingKey.UsdcTreasury,
    snapshot,
    // No admin behind this write. The null is the audit record: this row was
    // set by a machine, and the manual gate's row never is.
    null,
  )

  logger.debug('Treasury balance polled', {
    balanceBaseUnits: snapshot.balanceBaseUnits,
    paused,
    addresses,
  })

  await report(paused ? 'paused' : 'open', describe(balance, paused))
}

let interval: NodeJS.Timeout | null = null

/**
 * Start polling, unless this deployment does not accept USDC.
 *
 * The first check runs immediately rather than after one interval: the gate
 * fails closed while the balance is unknown, so waiting five minutes after every
 * deploy would shut the purchase path for five minutes after every deploy.
 */
const start = (): void => {
  if (!isUsdcConfigured()) {
    logger.info(
      'Not starting the USDC treasury balance job: no USDC configuration',
    )
    return
  }
  if (interval) {
    logger.warn('USDC treasury balance job already started; ignoring')
    return
  }

  logger.info('Starting USDC treasury balance job', {
    addresses: UsdcPaymentsUseCases.treasuryAddresses(),
    intervalMs: config.usdcPayments.balanceCheckIntervalMs,
    pauseThreshold: formatUsdcBaseUnits(pauseThresholdBaseUnits),
    resumeThreshold: formatUsdcBaseUnits(resumeThresholdBaseUnits),
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
  logger.info('Stopping USDC treasury balance job')
  clearInterval(interval)
  interval = null
}

export const usdcTreasuryBalanceJob = {
  start,
  stop,
  _runCheck: runCheck,
  _internal: internal,
  // Tests only: the alerting memo is module state, and a case that asserts
  // "alerts once" must be able to start from a known point.
  _resetReportedState: () => {
    lastReported = null
  },
}
