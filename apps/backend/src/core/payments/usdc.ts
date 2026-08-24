import { err, ok, Result } from 'neverthrow'
import {
  formatUsdcBaseUnits,
  USDC_DECIMALS,
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
// A pure string→bigint parser that happens to live with the oracle, which is
// the only other place that has to read a decimal out of the environment
// without going through a float. Imported rather than restated: two parsers for
// one job on a money path is two things that must agree.
import { parseDecimalToScaledBigint } from '../../infrastructure/services/priceOracle/quote.js'
import { slackNotifier } from '../../infrastructure/services/slack/index.js'
import { isAdmin } from '../featureFlags/index.js'

const logger = createLogger('core:payments:usdc')

/**
 * The USDC payment gates: an admin kill switch, a treasury-exposure cap, and the
 * price oracle's health.
 *
 * All three are read from the database rather than from memory, and that is the
 * load-bearing decision in this module. The process that OBSERVES (the payment
 * worker: `paymentManager.start()` runs in exactly one process) is never the
 * process that QUOTES (a frontend API replica, which never calls it). In-memory
 * gates would therefore be read as "unknown" by every process that matters, fail
 * closed, and USDC would never sell in the topology production actually runs.
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
// `balanceOf` returns.
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

export type Thresholds = { pause: bigint; resume: bigint }

let thresholds: Thresholds | null = null

/**
 * The cap and the resume line, in base units, parsed once on first use.
 *
 * Deliberately NOT parsed at import. This module is reachable from every backend
 * entrypoint — the download API and the publish worker pull it in through
 * `core/users/intents.ts` and through the feature-flag overlay — so an
 * import-time throw would turn a typo in a payments-only variable into a crash
 * loop for downloads and on-chain publishing. Exactly the failure #816 had to fix
 * in `paymentManager/chains.ts`, for the same reason.
 *
 * The fail-fast this gives up is bought back where it belongs: the treasury job's
 * `start()` calls this eagerly, so the process that owns payments still refuses
 * to run on a configuration it cannot parse.
 */
export const getThresholds = (): Thresholds => {
  if (thresholds) {
    return thresholds
  }

  const pause = parseUsdc(
    config.usdcPayments.pauseThresholdUsdc,
    'USDC_TREASURY_PAUSE_THRESHOLD',
  )
  const resume =
    config.usdcPayments.resumeThresholdUsdc === undefined
      ? pause
      : parseUsdc(
          config.usdcPayments.resumeThresholdUsdc,
          'USDC_TREASURY_RESUME_THRESHOLD',
        )

  // Checked against each other because getting them the wrong way round
  // produces a gate that oscillates rather than one that refuses: above
  // `resume` it pauses, below `pause` it resumes, and a balance between the two
  // does both on alternating polls — a flapping payment path and an alert every
  // five minutes.
  if (resume > pause) {
    throw new Error(
      `USDC_TREASURY_RESUME_THRESHOLD (${config.usdcPayments.resumeThresholdUsdc}) ` +
        'must be <= USDC_TREASURY_PAUSE_THRESHOLD ' +
        `(${config.usdcPayments.pauseThresholdUsdc}) — a resume threshold above ` +
        'the pause threshold makes the gate flap on every poll',
    )
  }

  thresholds = { pause, resume }
  return thresholds
}

// Tests only: drops the memo so a case can re-parse under different thresholds.
export const _resetThresholds = () => {
  thresholds = null
}

/**
 * The addresses whose USDC balances are summed against the cap.
 *
 * The receiver is ALWAYS included, unioned with whatever is configured. It is
 * where payments land, so a configuration that omitted it would measure the cap
 * over addresses the money never reaches and the gate would never bind —
 * reachable by reading `USDC_TREASURY_ADDRESSES` the obvious way and setting it
 * to the sweep destination alone.
 *
 * Resolved here rather than in `config` because the receiver is another config
 * value, and the config object cannot read itself while it is being built.
 *
 * Normalised through `getAddress`, which accepts any casing a valid address can
 * be written in — including all-uppercase, which viem's `isAddress` rejects under
 * its default `strict: true`. That distinction matters here: a dropped address
 * counts as a ZERO balance, so silently discarding one measures the cap over the
 * rest and lets the treasury hold arbitrarily more un-hedged USDC than
 * configured. An unusable entry therefore THROWS, and the poller turns that into
 * a closed gate rather than a smaller sum.
 *
 * @throws if any configured entry is not a usable address.
 */
export const treasuryAddresses = (): string[] => {
  const configured = config.usdcPayments.treasuryAddresses
  const receiver = config.ethereum.usdcReceiverAddress

  const normalised = [...configured, ...(receiver ? [receiver] : [])].map(
    (address) => {
      try {
        return getAddress(address.trim())
      } catch {
        throw new Error(
          `Invalid address in USDC_TREASURY_ADDRESSES: "${address}". Every ` +
            'entry must be a usable Ethereum address — an unreadable one would ' +
            'count as a zero balance and let the treasury exceed its cap.',
        )
      }
    },
  )

  // De-duplicated so listing the receiver explicitly alongside the default
  // cannot count its balance twice.
  return [...new Set(normalised)]
}

/**
 * What the poller writes about the treasury.
 *
 * `paused` is stored rather than derived from the balance on read because the
 * resume threshold makes the gate hysteretic: a balance between resume and pause
 * keeps whatever the gate already was, which is not a function of the balance
 * alone. The poller is the single writer and so the only thing that can see the
 * previous state.
 */
export type TreasurySnapshot = {
  balanceBaseUnits: string
  paused: boolean
  // The addresses that were summed for this reading. Recorded so a snapshot can
  // be read against a configuration that has since changed — "paused at 2,014"
  // means something different if it was counting two addresses.
  addresses: string[]
}

/**
 * What the poller writes about the oracle.
 *
 * The oracle is the third gate, and its health cannot be read where it is
 * needed: `priceOracle.getHealth()` is per-process in-memory state, so an API
 * replica that has never quoted knows nothing about it. Persisting it from the
 * one process that polls is the same trick the balance gate uses, and it is what
 * lets `/features` stop advertising a path on which every quote 503s.
 *
 * Amounts are strings because this is jsonb and they are bigints.
 */
export type OracleSnapshot = {
  healthy: boolean
  // OracleUnavailableReason when unhealthy; null when the rate read succeeded.
  reason: string | null
  // Serving a last-good rate rather than a fresh one. Healthy, but worth showing.
  servingStale: boolean
  usdPerAi3: string | null
  window: {
    sampleCount: number
    buyCount: number
    sellCount: number
    volumeUsdc: string
    oneSidedVolumeUsdc: string
    poolUsdcDepth: string
    newestSwapAt: string
    oldestSwapAt: string
  } | null
}

type ManualGateSetting = { enabled: boolean }

export type ManualGateState = {
  enabled: boolean
  source: UsdcManualGateSource
  updatedBy: string | null
  updatedAt: Date | null
}

/**
 * A stored snapshot is untyped JSON, so it is validated before it is believed.
 *
 * Not defensive habit — the direction of the failure is the point. A row missing
 * `paused` would read as "not paused" under a truthiness test and OPEN the money
 * gate, which is the one direction this module must never go. Rows are
 * hand-editable in an incident and their shape will change across releases, so
 * anything unrecognised is treated as no reading at all: BALANCE_UNKNOWN, which
 * fails closed.
 */
const DECIMAL_DIGITS = /^\d+$/

const isTreasurySnapshot = (value: unknown): value is TreasurySnapshot => {
  const snapshot = value as TreasurySnapshot | null
  return Boolean(
    snapshot &&
      typeof snapshot === 'object' &&
      typeof snapshot.paused === 'boolean' &&
      typeof snapshot.balanceBaseUnits === 'string' &&
      DECIMAL_DIGITS.test(snapshot.balanceBaseUnits) &&
      Array.isArray(snapshot.addresses),
  )
}

const isOracleSnapshot = (value: unknown): value is OracleSnapshot => {
  const snapshot = value as OracleSnapshot | null
  return Boolean(
    snapshot &&
      typeof snapshot === 'object' &&
      typeof snapshot.healthy === 'boolean',
  )
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
  // Missing, unreadable, or older than the max-stale window. All three mean the
  // same thing to a caller — the balance is not known well enough to sell
  // against — but the dashboard tells them apart via `checkedAt`.
  stale: boolean
  checkedAt: Date | null
  ageMs: number | null
}

export type OracleState = {
  snapshot: OracleSnapshot | null
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
const readTreasury = (
  setting: Awaited<
    ReturnType<typeof runtimeSettingsRepository.get<unknown>>
  > | null,
): TreasuryState => {
  if (!setting) {
    return { snapshot: null, stale: true, checkedAt: null, ageMs: null }
  }

  if (!isTreasurySnapshot(setting.value)) {
    logger.error(
      'Unreadable treasury snapshot in runtime_settings — treating the balance ' +
        'as unknown, which closes the USDC path',
      { value: setting.value },
    )
    return {
      snapshot: null,
      stale: true,
      checkedAt: setting.updatedAt,
      ageMs: setting.ageMs,
    }
  }

  return {
    snapshot: setting.value,
    stale: setting.ageMs > config.usdcPayments.balanceMaxStaleMs,
    checkedAt: setting.updatedAt,
    ageMs: setting.ageMs,
  }
}

const readOracle = (
  setting: Awaited<
    ReturnType<typeof runtimeSettingsRepository.get<unknown>>
  > | null,
): OracleState => {
  if (!setting) {
    return { snapshot: null, stale: true, checkedAt: null, ageMs: null }
  }

  if (!isOracleSnapshot(setting.value)) {
    logger.error(
      'Unreadable oracle snapshot in runtime_settings — treating the rate as ' +
        'unavailable, which closes the USDC path',
      { value: setting.value },
    )
    return {
      snapshot: null,
      stale: true,
      checkedAt: setting.updatedAt,
      ageMs: setting.ageMs,
    }
  }

  return {
    snapshot: setting.value,
    // Same window as the balance: both rows are written by the same poll, so one
    // clock and one staleness rule covers them.
    stale: setting.ageMs > config.usdcPayments.balanceMaxStaleMs,
    checkedAt: setting.updatedAt,
    ageMs: setting.ageMs,
  }
}

const getTreasuryState = async (): Promise<TreasuryState> =>
  readTreasury(
    await runtimeSettingsRepository.get<unknown>(RuntimeSettingKey.UsdcTreasury),
  )

const getOracleState = async (): Promise<OracleState> =>
  readOracle(
    await runtimeSettingsRepository.get<unknown>(RuntimeSettingKey.UsdcOracle),
  )

/**
 * Whether this deployment is selling storage for USDC right now.
 *
 * The one implementation of the composite, and the whole of the epic's
 * invariant:
 *
 *   accepting USDC ⇔ configured ∧ manualEnabled ∧ ¬balancePaused ∧ oracleHealthy
 *
 * `createIntent` and `/features` both call it, because two evaluations of the
 * same question that can disagree is a UI offering a path the backend then
 * refuses — the failure the feature-flag module already warns about, on the path
 * where it costs money.
 *
 * Reasons are checked cheapest and most structural first, and the first that
 * applies is the one reported: an operator's next action differs for each, and
 * the earlier ones survive fixing the later ones.
 *
 * The oracle conjunct is read from the poller's snapshot rather than from
 * `priceOracle.getHealth()`, which is per-process memory: a replica that has
 * never quoted would otherwise report health it has not observed. It is still
 * enforced independently at quote time, where the rate is actually needed — this
 * gate exists so the path is not ADVERTISED while every quote would 503.
 */
const getAvailability = async (): Promise<UsdcAvailability> => {
  if (!isUsdcConfigured()) {
    return { open: false, closedReason: UsdcClosedReason.NOT_CONFIGURED }
  }

  const [manual, treasury, oracle] = await runtimeSettingsRepository.getMany([
    RuntimeSettingKey.UsdcManualGate,
    RuntimeSettingKey.UsdcTreasury,
    RuntimeSettingKey.UsdcOracle,
  ])

  const manualEnabled = manual
    ? (manual.value as ManualGateSetting | null)?.enabled === true
    : config.usdcPayments.enabledByDefault

  if (!manualEnabled) {
    return { open: false, closedReason: UsdcClosedReason.MANUAL_OFF }
  }

  // Unknown before paused: the two produce the same refusal but a very
  // different operator response — one is "convert some USDC", the other is
  // "the payment worker cannot reach Ethereum".
  const treasuryState = readTreasury(treasury)
  if (treasuryState.stale || !treasuryState.snapshot) {
    return { open: false, closedReason: UsdcClosedReason.BALANCE_UNKNOWN }
  }

  if (treasuryState.snapshot.paused) {
    return { open: false, closedReason: UsdcClosedReason.TREASURY_CAP }
  }

  // Last, because it is the gate most likely to clear on its own and the one an
  // operator can do least about.
  const oracleState = readOracle(oracle)
  if (
    oracleState.stale ||
    !oracleState.snapshot ||
    !oracleState.snapshot.healthy
  ) {
    return { open: false, closedReason: UsdcClosedReason.ORACLE_UNAVAILABLE }
  }

  return { open: true }
}

/**
 * Set the manual gate, returning whether that changed anything.
 *
 * Idempotent, and only a real transition alerts: a dashboard toggle that posts
 * to Slack on every click is a dashboard that gets its channel muted.
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
 * Every figure comes from the same rows the gates are evaluated from, so the
 * dashboard cannot disagree with the refusal a user just got. Nothing here reads
 * a chain or a subgraph: the oracle's health is the poller's snapshot, with its
 * age, rather than a live read this process would then be the only witness to.
 */
const getStatus = async (
  executor: User,
): Promise<Result<UsdcPaymentsStatus, ForbiddenError>> => {
  if (!isAdmin(executor)) {
    return err(new ForbiddenError('Admin access required'))
  }

  const [availability, manualGate, treasury, oracle] = await Promise.all([
    getAvailability(),
    getManualGate(),
    getTreasuryState(),
    getOracleState(),
  ])

  const balance = treasury.snapshot
    ? BigInt(treasury.snapshot.balanceBaseUnits)
    : null

  // Both of these throw on an unusable configuration, and this endpoint is
  // exactly where that must not happen: a malformed threshold already stops the
  // gates job from polling, so the path is shut — and the page an operator opens
  // to find out WHY would be the page that 500s, taking the kill switch itself
  // off the screen with it. The error is data here, not an exception.
  let thresholds: Thresholds | null = null
  let thresholdError: string | null = null
  try {
    thresholds = getThresholds()
  } catch (error) {
    thresholdError = error instanceof Error ? error.message : String(error)
  }

  // The configured set, for a dashboard that has to say what WOULD be watched
  // when nothing has been polled yet.
  let configuredAddresses: string[] = []
  let addressError: string | null = null
  try {
    configuredAddresses = treasuryAddresses()
  } catch (error) {
    addressError = error instanceof Error ? error.message : String(error)
  }

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
        balance === null || !thresholds
          ? null
          : (thresholds.pause - balance).toString(),
      // With no usable reading this is the fail-closed default rather than an
      // observation, which is what `stale` next to it says.
      paused: treasury.stale ? true : (treasury.snapshot?.paused ?? true),
      stale: treasury.stale,
      checkedAt: treasury.checkedAt?.toISOString() ?? null,
      ageMs: treasury.ageMs,
      pauseThresholdBaseUnits: thresholds?.pause.toString() ?? null,
      resumeThresholdBaseUnits: thresholds?.resume.toString() ?? null,
      // Set when the cap itself is unreadable. The gates job refuses to poll on
      // this, so the path is closed until it is fixed and the worker restarted.
      thresholdError,
      maxStaleMs: config.usdcPayments.balanceMaxStaleMs,
      checkIntervalMs: config.usdcPayments.balanceCheckIntervalMs,
      addresses: treasury.snapshot?.addresses ?? configuredAddresses,
      addressError,
    },
    oracle: {
      // Unknown fails closed here too, and says so rather than claiming the
      // oracle is broken: nothing has polled, which is a different problem.
      healthy: Boolean(oracle.snapshot?.healthy) && !oracle.stale,
      reason: oracle.snapshot?.reason ?? null,
      servingStale: Boolean(oracle.snapshot?.servingStale),
      usdPerAi3: oracle.snapshot?.usdPerAi3 ?? null,
      stale: oracle.stale,
      checkedAt: oracle.checkedAt?.toISOString() ?? null,
      ageMs: oracle.ageMs,
      window: oracle.snapshot?.window ?? null,
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
    case UsdcClosedReason.TREASURY_CAP: {
      // Named with the figure when it can be read, and without it when it
      // cannot: this sentence goes into a 503 a user sees, and an unparseable
      // cap must not turn a refusal into an exception.
      let cap: string | null = null
      try {
        cap = formatUsdcBaseUnits(getThresholds().pause)
      } catch {
        cap = null
      }
      return (
        'the treasury is holding at or above its cap of un-converted USDC' +
        (cap ? ` (${cap})` : '')
      )
    }
    case UsdcClosedReason.BALANCE_UNKNOWN:
      return 'the treasury balance has not been read recently enough to trust'
    case UsdcClosedReason.ORACLE_UNAVAILABLE:
      return 'the AI3/USD rate cannot be established right now'
  }
}

export const UsdcPaymentsUseCases = {
  getAvailability,
  getManualGate,
  getTreasuryState,
  getOracleState,
  setManualGate,
  getStatus,
  describeClosedReason,
  treasuryAddresses,
  getThresholds,
}
