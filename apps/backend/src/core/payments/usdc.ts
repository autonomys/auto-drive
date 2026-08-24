import { err, ok, Result } from 'neverthrow'
import {
  User,
  UsdcAvailability,
  UsdcClosedReason,
  UsdcManualGateSource,
  UsdcPaymentsStatus,
} from '@auto-drive/models'
import { getAddress } from 'viem'
import { config, isUsdcConfigured } from '../../config.js'
import { ForbiddenError } from '../../errors/index.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import {
  RuntimeSettingKey,
  runtimeSettingsRepository,
} from '../../infrastructure/repositories/runtimeSettings.js'
import { priceOracle } from '../../infrastructure/services/priceOracle/index.js'
// A pure string→bigint parser that happens to live with the oracle, which is
// the only other place that has to read a decimal out of the environment
// without going through a float. Imported rather than restated: two parsers for
// one job on a money path is two things that must agree.
import { parseDecimalToScaledBigint } from '../../infrastructure/services/priceOracle/quote.js'
import { slackNotifier } from '../../infrastructure/services/slack/index.js'
import { formatUsdcBaseUnits, USDC_DECIMALS } from '../../shared/utils/index.js'
import { isAdmin } from '../featureFlags/index.js'

const logger = createLogger('core:payments:usdc')

/**
 * The USDC payment gates: an admin kill switch and a treasury-exposure cap.
 *
 * Both are DB-backed rather than in-memory, and that is the load-bearing
 * decision in this module. The process that POLLS the treasury balance is the
 * payment worker (`paymentManager.start()` runs in exactly one process), and the
 * process that QUOTES is a frontend API replica, which never calls it. An
 * in-memory gate would therefore be read as "unknown" by every process that
 * matters, fail closed, and USDC would never sell in the topology production
 * actually runs.
 *
 * So: one writer, N readers, one durable answer — and `GET /payments/usdc/status`
 * gives the same answer whichever process serves it.
 *
 * What this module does NOT gate: confirming, crediting, or re-processing an
 * intent that has already been paid. A user who paid always gets credits, and a
 * PENDING intent quoted while the gates were open stays payable for the rest of
 * its lock. The hard stop that rejects in-flight payments is `pause()` on the
 * receiver contract, which is manual escalation only and is deliberately not
 * wired to anything here.
 */

// Thresholds are configured in whole USDC because that is how a human reasons
// about an exposure cap, and compared in base units because that is what
// `balanceOf` returns. Converted once, here, so a malformed value fails at
// import naming the variable rather than as a BigInt(NaN) somewhere in a poll.
const parseUsdc = (raw: string, name: string): bigint => {
  try {
    return parseDecimalToScaledBigint(raw, USDC_DECIMALS)
  } catch {
    throw new Error(
      `Invalid ${name}: "${raw}" — use a plain decimal number of USDC ` +
        '(e.g. 2000 or 1500.50)',
    )
  }
}

export const pauseThresholdBaseUnits = parseUsdc(
  config.usdcPayments.pauseThresholdUsdc,
  'USDC_TREASURY_PAUSE_THRESHOLD',
)

export const resumeThresholdBaseUnits =
  config.usdcPayments.resumeThresholdUsdc === undefined
    ? pauseThresholdBaseUnits
    : parseUsdc(
        config.usdcPayments.resumeThresholdUsdc,
        'USDC_TREASURY_RESUME_THRESHOLD',
      )

// Checked against each other because getting them the wrong way round produces
// a gate that oscillates rather than one that refuses: above `resume` it pauses,
// below `pause` it resumes, and a balance between the two does both on
// alternating polls — a flapping payment path and an alert every five minutes.
if (resumeThresholdBaseUnits > pauseThresholdBaseUnits) {
  throw new Error(
    `USDC_TREASURY_RESUME_THRESHOLD (${config.usdcPayments.resumeThresholdUsdc}) ` +
      'must be <= USDC_TREASURY_PAUSE_THRESHOLD ' +
      `(${config.usdcPayments.pauseThresholdUsdc}) — a resume threshold above ` +
      'the pause threshold makes the gate flap on every poll',
  )
}

/**
 * The addresses whose USDC balances are summed against the cap.
 *
 * Defaults to the receiver alone. Resolved here rather than in `config` because
 * the default is another config value, and the config object cannot read itself
 * while it is being built.
 *
 * Checksummed so a lowercase address pasted out of a block explorer names the
 * same account as the receiver does, and de-duplicated so listing the receiver
 * explicitly alongside the default cannot count its balance twice.
 */
export const treasuryAddresses = (): string[] => {
  const configured = config.usdcPayments.treasuryAddresses
  const addresses =
    configured.length > 0
      ? configured
      : config.ethereum.usdcReceiverAddress
        ? [config.ethereum.usdcReceiverAddress]
        : []

  return [...new Set(addresses.map((address) => getAddress(address)))]
}

// What the poller writes. `paused` is stored rather than derived from the
// balance on read because the resume threshold makes the gate hysteretic: a
// balance between resume and pause keeps whatever the gate already was, which
// is not a function of the balance alone. The poller is the single writer and so
// the only thing that can see the previous state.
export type TreasurySnapshot = {
  balanceBaseUnits: string
  paused: boolean
  // The addresses that were summed for this reading. Recorded so a snapshot can
  // be read against a configuration that has since changed — "paused at 2,014"
  // means something different if it was counting two addresses.
  addresses: string[]
}

type ManualGateSetting = { enabled: boolean }

export type ManualGateState = {
  enabled: boolean
  source: UsdcManualGateSource
  updatedBy: string | null
  updatedAt: Date | null
}

/**
 * The manual gate, and where its value came from.
 *
 * An absent row is not "off" — it is "never set", and the value is then
 * `USDC_PAYMENTS_ENABLED`. Deliberately NOT seeded into the table at boot: every
 * replica would race to write it, and a "boot default" that stops mattering
 * after the first boot is a variable nobody can reason about. The first admin
 * flip writes the row, and from then on the row wins and the environment
 * variable is inert — which is why the source is reported to the dashboard.
 */
const getManualGate = async (): Promise<ManualGateState> => {
  const setting = await runtimeSettingsRepository.get<ManualGateSetting>(
    RuntimeSettingKey.UsdcManualGate,
  )

  if (!setting) {
    return {
      enabled: config.usdcPayments.enabledByDefault,
      source: UsdcManualGateSource.ENV_DEFAULT,
      updatedBy: null,
      updatedAt: null,
    }
  }

  return {
    // Defensive `=== true`: the value is JSON from the database, and anything
    // other than a literal true on a payment gate reads as off.
    enabled: setting.value?.enabled === true,
    source: UsdcManualGateSource.ADMIN,
    updatedBy: setting.updatedBy,
    updatedAt: setting.updatedAt,
  }
}

export type TreasuryState = {
  snapshot: TreasurySnapshot | null
  // Missing, or older than the max-stale window. Both mean the same thing to a
  // caller — the balance is not known well enough to sell against — but the
  // dashboard tells them apart via `checkedAt`.
  stale: boolean
  checkedAt: Date | null
  ageMs: number | null
}

/**
 * The last successful treasury reading, and whether it is still usable.
 *
 * A failed poll deliberately writes nothing, so the row's age IS the outage
 * signal: past `balanceMaxStaleMs` the balance is unknown and the gate fails
 * closed. Had a failure refreshed the timestamp, "unknown" would be unreachable
 * and the fail-closed rule would be dead code.
 */
const getTreasuryState = async (): Promise<TreasuryState> => {
  const setting = await runtimeSettingsRepository.get<TreasurySnapshot>(
    RuntimeSettingKey.UsdcTreasury,
  )

  if (!setting) {
    return { snapshot: null, stale: true, checkedAt: null, ageMs: null }
  }

  return {
    snapshot: setting.value,
    stale: setting.ageMs > config.usdcPayments.balanceMaxStaleMs,
    checkedAt: setting.updatedAt,
    ageMs: setting.ageMs,
  }
}

/**
 * Whether this deployment is selling storage for USDC right now.
 *
 * The one implementation of the composite. `createIntent` and `/features` both
 * call it, because two evaluations of the same question that can disagree is a
 * UI offering a path the backend then refuses — the failure the feature-flag
 * module already warns about, on the path where it costs money.
 *
 * Reasons are checked cheapest and most structural first, and the first that
 * applies is the one reported.
 *
 * The oracle is deliberately absent. Its health is per-process in-memory state,
 * so a replica that has never quoted cannot report on it honestly, and making
 * the public /features endpoint consult it would put a per-query-billed subgraph
 * call behind an unauthenticated route. It stays a refusal at quote time, inside
 * createIntent, which is where the rate is actually needed.
 */
const getAvailability = async (): Promise<UsdcAvailability> => {
  if (!isUsdcConfigured()) {
    return { open: false, closedReason: UsdcClosedReason.NOT_CONFIGURED }
  }

  const [manualGate, treasury] = await Promise.all([
    getManualGate(),
    getTreasuryState(),
  ])

  if (!manualGate.enabled) {
    return { open: false, closedReason: UsdcClosedReason.MANUAL_OFF }
  }

  // Unknown before paused: the two produce the same refusal but a very
  // different operator response — one is "convert some USDC", the other is
  // "the payment worker cannot reach Ethereum".
  if (treasury.stale || !treasury.snapshot) {
    return { open: false, closedReason: UsdcClosedReason.BALANCE_UNKNOWN }
  }

  if (treasury.snapshot.paused) {
    return { open: false, closedReason: UsdcClosedReason.TREASURY_CAP }
  }

  return { open: true }
}

/**
 * Set the manual gate, returning whether that changed anything.
 *
 * Idempotent, and only a real transition alerts: a dashboard toggle that posts
 * to Slack on every click is a dashboard that gets its channel muted. The
 * previous value comes back from the write itself rather than from a separate
 * read, so two concurrent flips cannot both report themselves as the change.
 */
const setManualGate = async (
  executor: User,
  enabled: boolean,
): Promise<Result<{ changed: boolean }, ForbiddenError>> => {
  if (!isAdmin(executor)) {
    logger.warn('Non-admin user attempted to flip the USDC manual gate', {
      publicId: executor.publicId,
      enabled,
    })
    return err(new ForbiddenError('Admin access required'))
  }

  const previous = await runtimeSettingsRepository.set<ManualGateSetting>(
    RuntimeSettingKey.UsdcManualGate,
    { enabled },
    executor.publicId,
  )

  // No previous row means the gate was running on the environment default, and
  // whether that counts as a change is exactly what it said.
  const previousEnabled =
    previous === null
      ? config.usdcPayments.enabledByDefault
      : previous.value?.enabled === true

  if (previousEnabled === enabled) {
    logger.info('USDC manual gate re-affirmed with no change', {
      publicId: executor.publicId,
      enabled,
    })
    return ok({ changed: false })
  }

  logger.warn('USDC manual gate flipped', {
    publicId: executor.publicId,
    enabled,
    previousEnabled,
  })

  await slackNotifier.send({
    title: enabled
      ? `:white_check_mark: USDC payments ENABLED by ${executor.publicId}`
      : `:no_entry: USDC payments DISABLED by ${executor.publicId}`,
    details: enabled
      ? 'New USDC intents may be quoted again, subject to the treasury cap and ' +
        'the price oracle.'
      : 'No new USDC intents will be quoted. Intents already quoted stay ' +
        'payable until they expire, and any payment that arrives is still ' +
        'credited. Only an admin can re-enable this.',
  })

  return ok({ changed: true })
}

/**
 * Everything the admin dashboard needs to explain the state of the USDC path.
 *
 * Calls the oracle before reporting its health, and that is deliberate: health
 * is per-process state, so a replica that has never quoted would otherwise
 * report an empty record as though it were an observation. Admin-only and behind
 * the oracle's own TTL cache, so the Graph spend is a dashboard refresh at most
 * once a minute.
 */
const getStatus = async (
  executor: User,
): Promise<Result<UsdcPaymentsStatus, ForbiddenError>> => {
  if (!isAdmin(executor)) {
    return err(new ForbiddenError('Admin access required'))
  }

  const [availability, manualGate, treasury, rate] = await Promise.all([
    getAvailability(),
    getManualGate(),
    getTreasuryState(),
    priceOracle.getPrice(),
  ])
  const health = priceOracle.getHealth()

  const balance = treasury.snapshot
    ? BigInt(treasury.snapshot.balanceBaseUnits)
    : null

  return ok({
    availability,
    configured: isUsdcConfigured(),
    manualGate: {
      enabled: manualGate.enabled,
      source: manualGate.source,
      updatedBy: manualGate.updatedBy,
      updatedAt: manualGate.updatedAt?.toISOString() ?? null,
    },
    treasury: {
      balanceBaseUnits: balance?.toString() ?? null,
      // Negative once the cap is exceeded, which is the number an operator
      // wants: "how much over am I" is the conversion size.
      headroomBaseUnits:
        balance === null ? null : (pauseThresholdBaseUnits - balance).toString(),
      // With no usable reading this is the fail-closed default rather than an
      // observation, which is what `stale` next to it says.
      paused: treasury.stale ? true : (treasury.snapshot?.paused ?? true),
      stale: treasury.stale,
      checkedAt: treasury.checkedAt?.toISOString() ?? null,
      ageMs: treasury.ageMs,
      pauseThresholdBaseUnits: pauseThresholdBaseUnits.toString(),
      resumeThresholdBaseUnits: resumeThresholdBaseUnits.toString(),
      maxStaleMs: config.usdcPayments.balanceMaxStaleMs,
      checkIntervalMs: config.usdcPayments.balanceCheckIntervalMs,
      addresses: treasury.snapshot?.addresses ?? treasuryAddresses(),
    },
    oracle: {
      healthy: rate.isOk(),
      currentFailureReason: rate.isErr() ? rate.error.reason : null,
      lastFailureReason: health.lastFailureReason,
      lastFailureAt: health.lastFailureAt?.toISOString() ?? null,
      lastSuccessAt: health.lastSuccessAt?.toISOString() ?? null,
      servingStale: health.servingStale,
      window: health.window
        ? {
            usdPerAi3: health.window.usdPerAi3.toString(),
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
    },
  })
}

/**
 * A closed gate, in a sentence an operator or a log reader can act on.
 *
 * Kept next to the reasons rather than in the controller so the wording is the
 * same in an API response, a log line and an alert.
 */
const describeClosedReason = (reason: UsdcClosedReason): string => {
  switch (reason) {
    case UsdcClosedReason.NOT_CONFIGURED:
      return 'this deployment has no complete Ethereum USDC configuration'
    case UsdcClosedReason.MANUAL_OFF:
      return 'an admin has USDC payments switched off'
    case UsdcClosedReason.TREASURY_CAP:
      return (
        'the treasury is holding at or above its cap of un-converted USDC ' +
        `(${formatUsdcBaseUnits(pauseThresholdBaseUnits)})`
      )
    case UsdcClosedReason.BALANCE_UNKNOWN:
      return 'the treasury balance has not been read recently enough to trust'
  }
}

export const UsdcPaymentsUseCases = {
  getAvailability,
  getManualGate,
  getTreasuryState,
  setManualGate,
  getStatus,
  describeClosedReason,
  treasuryAddresses,
  pauseThresholdBaseUnits,
  resumeThresholdBaseUnits,
}
