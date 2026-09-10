import { err, ok, Result } from 'neverthrow'
import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import { withTimeout } from '../../../shared/utils/index.js'
import {
  isFresh,
  isWithinBounds,
  oneSidedVolumeUsdc,
  parseDecimalToScaledBigint,
  trimOutliers,
  volumeWeightedPrice,
  windowVolumeUsdc,
} from './quote.js'
import { fetchRecentSwaps, SubgraphConfigError } from './subgraph.js'
import {
  OracleUnavailableError,
  type OracleHealth,
  type OraclePrice,
  type OracleUnavailableReason,
  type SwapWindow,
} from './types.js'

const logger = createLogger('PriceOracle')

// Parse a configured USD/AI3 bound into the 1e18-scaled integer domain. Reads
// the raw env string directly (config keeps it unparsed) so we neither lose
// precision nor trip Number.toString()'s exponential notation for small values
// (e.g. Number('0.0000001').toString() === '1e-7'), and we fail fast at import
// with a message that names the offending variable.
const parseBound = (raw: string, name: string): bigint => {
  try {
    return parseDecimalToScaledBigint(raw)
  } catch {
    throw new Error(
      `Invalid ${name}: "${raw}" — use a plain decimal (e.g. 0.0001), not ` +
        'exponential notation',
    )
  }
}

const minScaled = parseBound(
  config.priceOracle.minUsdPerAi3,
  'ORACLE_MIN_USD_PER_AI3',
)
const maxScaled = parseBound(
  config.priceOracle.maxUsdPerAi3,
  'ORACLE_MAX_USD_PER_AI3',
)
if (minScaled > maxScaled) {
  throw new Error(
    `ORACLE_MIN_USD_PER_AI3 (${config.priceOracle.minUsdPerAi3}) must be <= ` +
      `ORACLE_MAX_USD_PER_AI3 (${config.priceOracle.maxUsdPerAi3})`,
  )
}

if (config.priceOracle.minSwapSamples > config.priceOracle.maxWindowSamples) {
  throw new Error(
    `ORACLE_MIN_SWAP_SAMPLES (${config.priceOracle.minSwapSamples}) must be ` +
      `<= ORACLE_MAX_WINDOW_SAMPLES (${config.priceOracle.maxWindowSamples}) — ` +
      'the floor cannot exceed the number of swaps ever requested, or every ' +
      'window fails the sample-count guard',
  )
}

// The two time bounds are checked against each other because getting them the
// wrong way round WEAKENS the oracle silently, unlike the misconfigurations
// above which merely refuse everything. The window filter runs first, so if it
// is the tighter of the two, every surviving fill is younger than the freshness
// bound by construction and the "is this market still alive" guard can never
// fire — a market that stopped six days ago would be priced as current.
if (config.priceOracle.maxSwapAgeMs > config.priceOracle.maxWindowAgeMs) {
  throw new Error(
    `ORACLE_MAX_SWAP_AGE_MS (${config.priceOracle.maxSwapAgeMs}) must be <= ` +
      `ORACLE_MAX_WINDOW_AGE_MS (${config.priceOracle.maxWindowAgeMs}) — the ` +
      'window filter runs first, so a wider freshness bound than window bound ' +
      'makes the freshness guard unreachable',
  )
}

// Percent thresholds are converted to basis points once, at load, so a
// malformed value fails here — naming the variable — rather than as a bare
// `RangeError` from BigInt(NaN) at the first import that pulls this module in.
const parsePercentToBps = (value: number, name: string): bigint => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Invalid ${name}: "${value}" — use a non-negative number of percent ` +
        '(e.g. 2 or 2.5)',
    )
  }
  return BigInt(Math.round(value * 100))
}

const maxSwapDeviationBps = parsePercentToBps(
  config.priceOracle.maxSwapDeviationPercent,
  'ORACLE_MAX_SWAP_DEVIATION',
)

// Configured in whole USDC because that is how a human reasons about "is this
// market thick enough to price against"; compared in base units because that is
// what the samples carry.
const parseUsdcFloor = (raw: string, name: string): bigint => {
  try {
    return parseDecimalToScaledBigint(raw, 6)
  } catch {
    throw new Error(
      `Invalid ${name}: "${raw}" — use a plain decimal number of USDC ` +
        '(e.g. 1000)',
    )
  }
}

const minWindowVolumeBaseUnits = parseUsdcFloor(
  config.priceOracle.minWindowVolumeUsdc,
  'ORACLE_MIN_WINDOW_VOLUME_USDC',
)

const minPoolDepthBaseUnits = parseUsdcFloor(
  config.priceOracle.minPoolUsdcDepth,
  'ORACLE_MIN_POOL_USDC_DEPTH',
)

type CacheEntry = { value: OraclePrice; expiresAt: number }

// Module-level singleton state (same shape as paymentManager):
// - `cache`         last successful fresh price, valid until expiresAt.
// - `lastGood`      last successful price, served (as stale) during an outage.
// - `nextAttemptAt` earliest time we may query the indexer again; set after
//                   EVERY attempt so a degraded upstream is retried at most once
//                   per cacheTtlMs rather than on every request.
// - `inFlight`      collapses concurrent refreshes into one upstream round-trip.
let cache: CacheEntry | null = null
let lastGood: OraclePrice | null = null
let nextAttemptAt = 0
let inFlight: Promise<Result<OraclePrice, OracleUnavailableError>> | null = null
// Last observed state, for the admin dashboard and the treasury report. Held
// separately from `cache` because a failure must not evict a usable price, and
// because "why is the USDC path shut" is answered by the failure, not the price.
let lastWindow: SwapWindow | null = null
let lastSuccessAt: Date | null = null
// The last failure, whenever it was. Retained through a recovery, and always
// set as a PAIR, so a dashboard cannot render a failure time next to a null
// reason — which is what happened when a success cleared one and not the other.
let lastFailureAt: Date | null = null
let lastFailureReason: OracleUnavailableReason | null = null
// Whether the MOST RECENT attempt failed, and how. Distinct from the pair
// above: that one answers "which guard last fired", this one answers "is the
// oracle degraded right now", and only the second may be cleared by a success.
let currentFailureReason: OracleUnavailableReason | null = null

const unavailable = (
  message: string,
  reason: OracleUnavailableReason,
): OracleUnavailableError => {
  lastFailureAt = new Date()
  lastFailureReason = reason
  currentFailureReason = reason
  logger.warn(`Price oracle unavailable (${reason}): ${message}`)
  return new OracleUnavailableError(message, reason)
}

/**
 * Read the recent swap window and reduce it to one rate, or refuse.
 *
 * The guards run cheapest-and-most-structural first, and each one fails closed:
 * there is no partial answer between "here is a rate the market supports" and
 * "do not charge anyone right now".
 *
 * Order is deliberate. Indexer lag and a truncated page come before anything
 * derived from the samples, because both say the READ cannot be reasoned from —
 * a stalled indexer makes every later judgement a statement about the past
 * dressed up as the present, and a cut-short window turns the median back into
 * a count-based one whatever the age bound says. Freshness comes before
 * the outlier trim, because trimming cannot rescue a window whose newest fill
 * is a week old. Volume is judged after the trim, since the volume that backs
 * the average is the surviving volume, not what was discarded with the
 * outliers. The newest fill's veto sits immediately after the trim, because it
 * asks a question only the trim's result can answer: did we just discard the
 * market's latest price as an outlier?
 */
const buildWindow = async (): Promise<
  Result<SwapWindow, OracleUnavailableError>
> => {
  const controller = new AbortController()
  // One clock for the whole judgement, read before the query rather than after
  // it: the window's lower bound goes INTO the request, and the age guards below
  // must measure against the same instant that selected the fills.
  const now = Date.now()
  let response: Awaited<ReturnType<typeof fetchRecentSwaps>>
  try {
    response = await withTimeout(
      internal.fetchRecentSwaps(
        {
          sinceMs: now - config.priceOracle.maxWindowAgeMs,
          maxSamples: config.priceOracle.maxWindowSamples,
        },
        controller.signal,
      ),
      config.priceOracle.requestTimeoutMs,
      'priceOracle:subgraph',
      controller,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A response that does not describe the pool we pinned is our mistake, not
    // The Graph's, and it is the one failure here that no amount of waiting
    // clears. Reporting it as `gateway` would send an operator to a status page
    // to diagnose a stale constant.
    return err(
      error instanceof SubgraphConfigError
        ? unavailable(
            `the oracle is not configured to read this pool: ${message}`,
            'misconfigured',
          )
        : unavailable(`could not read the subgraph: ${message}`, 'gateway'),
    )
  }

  // Not a refusal — a dropped row only shrinks the window, and the sample floor
  // judges what is left. But it means the indexer is emitting an amount format
  // this oracle does not read, which is worth seeing in a log rather than
  // deducing from a sample count that came back mysteriously low.
  if (response.unparsedSwaps > 0) {
    logger.warn(
      `Price oracle dropped ${response.unparsedSwaps} fill(s) whose amounts ` +
        'did not parse as plain decimals; the window was built from the rest',
    )
  }

  if (response.hasIndexingErrors) {
    return err(
      unavailable(
        'the subgraph reports indexing errors, so the swap history it served ' +
          'may be missing fills we cannot detect from here',
        'indexer-error',
      ),
    )
  }

  // A full page means the window may extend past what came back, so the fills we
  // hold are the newest N of it and the median is a count-based one again — the
  // exact property selecting by time exists to remove. There is no honest way to
  // average what we know might be a slice, so this refuses and names the knob to
  // raise. It sits with the other structural checks rather than among the market
  // ones because it says the QUERY was wrong, not that the market is.
  if (response.truncated) {
    return err(
      unavailable(
        `the pool filled at least ${config.priceOracle.maxWindowSamples} times ` +
          'inside the window, which is the response cap, so the fills read back ' +
          'may be only its newest slice — raise ORACLE_MAX_WINDOW_SAMPLES',
        'window-truncated',
      ),
    )
  }

  if (
    !isFresh(response.indexerTimestampMs, now, config.priceOracle.maxIndexLagMs)
  ) {
    const lagMs = now - response.indexerTimestampMs
    return err(
      unavailable(
        `the indexer is ${Math.round(lagMs / 1000)}s behind at block ` +
          `${response.indexerBlock}, past the ` +
          `${Math.round(config.priceOracle.maxIndexLagMs / 1000)}s limit`,
        'indexer-lag',
      ),
    )
  }

  // Depth, asked before anything about the fills, because it is a property of
  // the POOL rather than of the window and needs no sample to judge.
  //
  // It is here because the volume floor below cannot carry this weight alone.
  // Volume is what traded, and trading in a circle is cheap: a buy and a sell of
  // the same size each contribute their full USDC leg, so an attacker clears a
  // volume floor of N for roughly the swap fee on N — about 1% on this pool —
  // while honest flow has to genuinely trade N. Raising the floor until it deters
  // the attacker raises the bar for real traders a hundred times faster.
  //
  // Depth cannot be churned into existence. It can still be RAISED by buying,
  // which hands the pool USDC and takes AI3 away, but that commits the whole
  // amount as inventory at price risk plus a round trip's fees — an order of
  // magnitude dearer than churn, not a closed door.
  if (response.poolUsdcDepth < minPoolDepthBaseUnits) {
    return err(
      unavailable(
        `the pool holds ${response.poolUsdcDepth} USDC base units, below the ` +
          `${config.priceOracle.minPoolUsdcDepth} USDC floor — its fills are ` +
          'not backed by a market deep enough to price from',
        'thin-liquidity',
      ),
    )
  }

  // Two age bounds, because they answer two different questions.
  //
  // The window bound is the one the query already applied, and it is a filter
  // rather than a refusal: a fill older than this may not VOTE. Without it a
  // majority of ancient fills could carry the median — at which point the trim
  // discards the recent ones as outliers and the oracle serves a price from
  // another era. A filter rather than a check on the oldest sample, or one stale
  // fill would deny an otherwise live window.
  //
  // Re-applied here against the same clock even though the server filtered on
  // it, because this is where the bound means something and the override may
  // point at a mirror that honours the argument differently. It can only ever
  // shrink the window, so the cost of it being redundant is nothing.
  const inWindow = response.samples.filter((sample) =>
    isFresh(sample.timestampMs, now, config.priceOracle.maxWindowAgeMs),
  )
  if (inWindow.length < config.priceOracle.minSwapSamples) {
    // Two different situations, and blaming the window for both sends an
    // operator looking for fills that were filtered when the pool never traded
    // them: nothing was dropped when the counts agree.
    const windowDays = Math.round(
      config.priceOracle.maxWindowAgeMs / 86_400_000,
    )
    return err(
      unavailable(
        inWindow.length === response.samples.length
          ? `the pool filled only ${inWindow.length} usable swaps in the last ` +
              `${windowDays}d, below the floor of ` +
              `${config.priceOracle.minSwapSamples}`
          : `only ${inWindow.length} of ${response.samples.length} returned ` +
              `swaps fall within the ${windowDays}d window, below the floor ` +
              `of ${config.priceOracle.minSwapSamples}`,
        'insufficient-samples',
      ),
    )
  }

  // The freshness bound then asks whether the market is alive NOW. A window can
  // be full of fills that all sit inside the window bound and still describe a
  // market that stopped days ago.
  const windowNewestMs = Math.max(...inWindow.map((s) => s.timestampMs))
  if (!isFresh(windowNewestMs, now, config.priceOracle.maxSwapAgeMs)) {
    const ageMs = now - windowNewestMs
    return err(
      unavailable(
        `the most recent swap is ${Math.round(ageMs / 3_600_000)}h old, past ` +
          `the ${Math.round(config.priceOracle.maxSwapAgeMs / 3_600_000)}h ` +
          'limit — the market has stopped, whatever the indexer reports',
        'stale-window',
      ),
    )
  }

  const { kept, dropped } = trimOutliers(inWindow, maxSwapDeviationBps)
  if (kept.length < config.priceOracle.minSwapSamples) {
    return err(
      unavailable(
        `${dropped} of ${inWindow.length} swaps deviated past ` +
          `${config.priceOracle.maxSwapDeviationPercent}% from the window ` +
          `median, leaving ${kept.length} — below the floor of ` +
          `${config.priceOracle.minSwapSamples}`,
        'insufficient-samples',
      ),
    )
  }

  // The trim's median is count-based, which cuts both ways. It removes the lone
  // absurd print it was built for — but when the MARKET moves, the fills
  // carrying the new price are the minority, so those are the ones it discards,
  // and what survives is a majority that has not re-priced yet. The average is
  // then serenely wrong in the direction of the old regime, with every other
  // guard satisfied: enough samples, enough volume, spanning hours, in bounds.
  //
  // This is not hypothetical. On this pool's own history (2026-08-10) the trim
  // dropped the three most recent fills and kept the seven older ones, and the
  // rate that would have been served sat 96% above the last price the pool
  // actually filled at. At 1.6 swaps/day the window needs days to catch up, and
  // every purchase in between is charged at a price nobody traded.
  //
  // So: the newest fill in the window gets a veto. If it is itself an outlier
  // against the rest, the window is describing a regime the market has left,
  // and the answer is to stop quoting until enough fills agree again. Denial,
  // not mispricing — the same direction every other guard here fails in. It
  // costs nothing when the market is merely volatile-but-continuous, because
  // then the newest fill sits inside the band.
  //
  // The veto asks which SAMPLES survived, not whether the surviving maximum
  // timestamp still equals the window's. Timestamps are not unique here: swaps
  // in the same block share one, and 7 of this pool's timestamps carry more than
  // one fill (three, at the most). With a tie, trimming one of them leaves both
  // maxima equal, and comparing them would report a window as intact precisely
  // when the newest print had been discarded — the veto silently stops firing in
  // the case a sandwich produces.
  //
  // Every fill at that timestamp has to survive, because with a tie there is no
  // ordering in the data that says which of them is the market's last word: the
  // query can only sort by timestamp. Requiring all of them refuses in the
  // ambiguous case, which is the direction this guard exists to fail in.
  const survived = new Set(kept)
  const newestFills = inWindow.filter((s) => s.timestampMs === windowNewestMs)
  const vetoing = newestFills.filter((s) => !survived.has(s))
  if (vetoing.length > 0) {
    return err(
      unavailable(
        `the most recent fill (${Math.round(
          (now - windowNewestMs) / 60_000,
        )}min ago) deviated past ` +
          `${config.priceOracle.maxSwapDeviationPercent}% from the median of ` +
          `this ${inWindow.length}-fill window and was trimmed` +
          (newestFills.length > 1
            ? ` (${vetoing.length} of the ${newestFills.length} fills sharing ` +
              'that timestamp)'
            : '') +
          ', so the average describes a price the market has since left',
        'market-moved',
      ),
    )
  }

  // Every field from here describes the SURVIVING fills, so the span reported
  // to an operator belongs to the same set as the count and the volume.
  const newestSwapMs = Math.max(...kept.map((s) => s.timestampMs))
  const oldestSwapMs = Math.min(...kept.map((s) => s.timestampMs))

  // The same count-based median has an adversarial edge as well as the accident
  // above: whoever supplies most of the window sets the price, and on a pool
  // this thin that is a handful of fills. Volume alone does not stop it, since
  // an attacker who clears the volume floor with their own trades clears it with
  // trades priced wherever they like.
  //
  // Time is the scarce thing they cannot fake. Six fills in one block are
  // something anyone can print on demand; the same six spread across hours must
  // be defended against everyone else trading in between, and it gives the
  // balance alerting a window to fire in. This is the guard that turns the
  // attack from mispricing into cost.
  const spanMs = newestSwapMs - oldestSwapMs
  if (spanMs < config.priceOracle.minWindowSpanMs) {
    return err(
      unavailable(
        `the ${kept.length} surviving swaps span only ` +
          `${Math.round(spanMs / 60_000)}min, under the ` +
          `${Math.round(config.priceOracle.minWindowSpanMs / 60_000)}min ` +
          'minimum — a burst of fills is not a market that held a price',
        'narrow-window',
      ),
    )
  }

  // Judged on the larger side, not the total: a round trip contributes both of
  // its legs to a total while committing capital once, so a total is inflated by
  // exactly the churn this floor exists to reject. The total is still reported —
  // it is what "how much traded" means — but it is not what decides.
  const volumeUsdc = windowVolumeUsdc(kept)
  const oneSidedVolume = oneSidedVolumeUsdc(kept)
  if (oneSidedVolume < minWindowVolumeBaseUnits) {
    return err(
      unavailable(
        `the window's larger side traded ${oneSidedVolume} USDC base units ` +
          `(${volumeUsdc} counting both), below the ` +
          `${config.priceOracle.minWindowVolumeUsdc} USDC floor — an average ` +
          'over dust is not a market price',
        'thin-volume',
      ),
    )
  }

  const usdPerAi3 = volumeWeightedPrice(kept)
  if (!isWithinBounds(usdPerAi3, minScaled, maxScaled)) {
    return err(
      unavailable(
        `the window averages ${usdPerAi3} (scaled 1e18), outside the ` +
          `configured bounds [${minScaled}, ${maxScaled}]`,
        'out-of-bounds',
      ),
    )
  }

  return ok({
    usdPerAi3,
    sampleCount: kept.length,
    droppedOutliers: dropped,
    // Recorded, never judged. A window's balance is a property of the flow and
    // cannot be reconstructed later, so it is captured as it goes past.
    buyCount: kept.filter((s) => s.direction === 'buy').length,
    sellCount: kept.filter((s) => s.direction === 'sell').length,
    volumeUsdc,
    oneSidedVolumeUsdc: oneSidedVolume,
    poolUsdcDepth: response.poolUsdcDepth,
    newestSwapMs,
    oldestSwapMs,
    indexerBlock: response.indexerBlock,
    indexerTimestampMs: response.indexerTimestampMs,
  })
}

/**
 * The DISPLAY window: the same pool, judged for an estimate rather than a
 * charge.
 *
 * Deliberately a separate function rather than `buildWindow` with a profile
 * argument. That function's guards are ordered, and the order is load-bearing —
 * each comment there explains what the previous guard has already ruled out.
 * Threading a flag through it would leave every one of those explanations
 * conditionally true, and the path it protects is the one that decides what
 * somebody pays. This duplicates a fetch and a handful of lines instead, and
 * keeps the money path exactly as it was.
 *
 * What it keeps, and why only these:
 *
 *   - the sanity bounds, because a rate outside them is a bug in us, and
 *     rendering it would be worse than rendering nothing;
 *   - the indexer's own liveness and its indexing-error flag, because both say
 *     the READ cannot be reasoned from, whatever it is for;
 *   - a non-empty window, which is what "we have no estimate" actually means;
 *   - the outlier trim, once there are enough fills for a median to mean
 *     something, because one absurd print is as unwelcome in an estimate as in
 *     a quote.
 *
 * What it drops, and why: pool depth, one-sided volume, window span and the
 * newest-fill veto all exist to make manipulating the rate expensive. Nobody is
 * charged from this number, so there is nothing here to buy. Truncation is not
 * refused either — a full page is the NEWEST fills, which for an estimate is
 * the good half of the window rather than a reason to withhold it.
 */
const buildDisplayWindow = async (): Promise<
  Result<SwapWindow, OracleUnavailableError>
> => {
  const controller = new AbortController()
  const now = Date.now()
  let response: Awaited<ReturnType<typeof fetchRecentSwaps>>
  try {
    response = await withTimeout(
      internal.fetchRecentSwaps(
        {
          sinceMs: now - config.priceOracle.display.windowAgeMs,
          maxSamples: config.priceOracle.maxWindowSamples,
        },
        controller.signal,
      ),
      config.priceOracle.requestTimeoutMs,
      'priceOracle:subgraph:display',
      controller,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return err(
      error instanceof SubgraphConfigError
        ? unavailable(
            `the oracle is not configured to read this pool: ${message}`,
            'misconfigured',
          )
        : unavailable(`could not read the subgraph: ${message}`, 'gateway'),
    )
  }

  if (response.hasIndexingErrors) {
    return err(
      unavailable(
        'the subgraph reports indexing errors, so the swap history it served ' +
          'may be missing fills we cannot detect from here',
        'indexer-error',
      ),
    )
  }

  if (
    !isFresh(
      response.indexerTimestampMs,
      now,
      config.priceOracle.display.maxIndexLagMs,
    )
  ) {
    const lagMs = now - response.indexerTimestampMs
    return err(
      unavailable(
        `the indexer is ${Math.round(lagMs / 60_000)}min behind at block ` +
          `${response.indexerBlock}, past the display limit of ` +
          `${Math.round(config.priceOracle.display.maxIndexLagMs / 60_000)}min`,
        'indexer-lag',
      ),
    )
  }

  // Re-applied against our own clock for the same reason the strict path does
  // it: the bound is ours, and an overridden endpoint may honour the argument
  // differently. It can only shrink the window.
  const inWindow = response.samples.filter((sample) =>
    isFresh(sample.timestampMs, now, config.priceOracle.display.windowAgeMs),
  )
  if (inWindow.length < config.priceOracle.display.minSamples) {
    const windowDays = Math.round(
      config.priceOracle.display.windowAgeMs / 86_400_000,
    )
    return err(
      unavailable(
        `the pool filled ${inWindow.length} times in the last ${windowDays}d, ` +
          `below the display floor of ${config.priceOracle.display.minSamples}` +
          ' — there is no trade to estimate from',
        'insufficient-samples',
      ),
    )
  }

  // Trim only once a median means something. On two fills the median is their
  // midpoint and both sit equally far from it, so the trim either keeps both or
  // discards both — and discarding both would turn "the pool traded twice" into
  // "we have no idea", which is exactly the outcome this profile exists to
  // avoid. Below the threshold the window is averaged as it came.
  const shouldTrim =
    inWindow.length >= config.priceOracle.display.minSamplesToTrim
  const { kept, dropped } = shouldTrim
    ? trimOutliers(inWindow, maxSwapDeviationBps)
    : { kept: inWindow, dropped: 0 }
  // A trim that empties the window falls back to the untrimmed fills rather
  // than refusing: every sample being an outlier against its own median is a
  // statement about spread, not about absence, and the bounds guard below is
  // what decides whether the result is printable.
  const surviving = kept.length > 0 ? kept : inWindow

  const newestSwapMs = Math.max(...surviving.map((s) => s.timestampMs))
  const oldestSwapMs = Math.min(...surviving.map((s) => s.timestampMs))
  const volumeUsdc = windowVolumeUsdc(surviving)

  const usdPerAi3 = volumeWeightedPrice(surviving)
  if (!isWithinBounds(usdPerAi3, minScaled, maxScaled)) {
    return err(
      unavailable(
        `the window averages ${usdPerAi3} (scaled 1e18), outside the ` +
          `configured bounds [${minScaled}, ${maxScaled}]`,
        'out-of-bounds',
      ),
    )
  }

  return ok({
    usdPerAi3,
    sampleCount: surviving.length,
    droppedOutliers: kept.length > 0 ? dropped : 0,
    buyCount: surviving.filter((s) => s.direction === 'buy').length,
    sellCount: surviving.filter((s) => s.direction === 'sell').length,
    volumeUsdc,
    oneSidedVolumeUsdc: oneSidedVolumeUsdc(surviving),
    poolUsdcDepth: response.poolUsdcDepth,
    newestSwapMs,
    oldestSwapMs,
    indexerBlock: response.indexerBlock,
    indexerTimestampMs: response.indexerTimestampMs,
  })
}

// Grouped so unit tests can spy on the collaborators (jest.spyOn), mirroring how
// paymentManager exposes _viemClient. Not for use outside tests.
const internal = {
  fetchRecentSwaps,
  buildWindow,
  buildDisplayWindow,
}

// Serve the last good price as a stale fallback, or error if none is fresh
// enough.
//
// The error always carries the reason the READ failed, never "there was no
// fallback": the absence of a fallback is why the caller is seeing an error at
// all, but what closed the payment path is the guard, and that is what a status
// code (#747) and a dashboard (#811) have to name. Whether a fallback was
// available is visible through `getHealth`.
const serveStaleOrError = (
  failureReason: OracleUnavailableReason,
): Result<OraclePrice, OracleUnavailableError> => {
  if (
    lastGood &&
    Date.now() - lastGood.asOf.getTime() < config.priceOracle.maxStaleMs
  ) {
    // A stale fallback is never a fresh TTL cache hit — `fromCache` is reserved
    // for the live cache hit in getPrice, so it is always false here.
    return ok({ ...lastGood, fromCache: false, stale: true })
  }
  return err(
    new OracleUnavailableError(
      'Price oracle unavailable: the recent-swap window could not be used ' +
        `(${failureReason}), and no last-good price is within ` +
        `${config.priceOracle.maxStaleMs}ms`,
      failureReason,
    ),
  )
}

// Refresh from the indexer, updating cache + last-good on success. Always
// resolves (never rejects) so the neverthrow contract holds.
const refresh = async (): Promise<
  Result<OraclePrice, OracleUnavailableError>
> => {
  // buildWindow returns a Result for everything it anticipates, but the
  // statistics it calls throw on inputs that should be impossible (a zero AI3
  // leg, an empty window). "Should be impossible" is a property of the adapter,
  // asserted across a module boundary — so it is contained here rather than
  // trusted. Without this, a violated invariant would reject `getPrice()`
  // instead of returning a typed error, and every concurrent caller sharing the
  // in-flight promise would get an unhandled rejection.
  //
  // Reported as `internal`, not `gateway`. What lands here is OUR invariant
  // giving way — every upstream failure already has its own reason by this point
  // — and the two demand opposite responses: `gateway` means wait, this means
  // read the stack trace that was just logged. Labelling it `gateway` is the
  // same misdiagnosis `misconfigured` was split out to prevent, one layer down.
  let window: Awaited<ReturnType<typeof buildWindow>>
  try {
    window = await internal.buildWindow()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(error, 'Price oracle: unexpected failure building the window')
    window = err(
      unavailable(
        `the oracle itself failed while building the window (${message}) — ` +
          'this is a bug in the oracle, not a condition upstream',
        'internal',
      ),
    )
  }
  // Throttle the next upstream attempt regardless of outcome, so a degraded
  // source is retried at most once per cacheTtlMs instead of on every request.
  nextAttemptAt = Date.now() + config.priceOracle.cacheTtlMs

  if (window.isErr()) {
    return serveStaleOrError(window.error.reason)
  }

  const value: OraclePrice = {
    usdPerAi3: window.value.usdPerAi3,
    asOf: new Date(),
    fromCache: false,
    stale: false,
  }
  cache = { value, expiresAt: Date.now() + config.priceOracle.cacheTtlMs }
  lastGood = value
  lastWindow = window.value
  lastSuccessAt = value.asOf
  // Only the "right now" half is cleared: which guard last fired stays on the
  // record for the dashboard, paired with when it fired.
  currentFailureReason = null
  logger.debug(
    `Price oracle refreshed AI3/USD=${window.value.usdPerAi3.toString()} ` +
      `(scaled 1e18) from ${window.value.sampleCount} swaps totalling ` +
      `${window.value.volumeUsdc} USDC base units`,
  )
  return ok(value)
}

/**
 * Current AI3/USD price as USD-per-AI3 scaled by USD_RATE_SCALE (1e18).
 *
 * The volume-weighted average of the pool's most recent swaps — what the market
 * has actually been filling at, rather than what the pool would quote for one
 * more trade. Both the display rate and the charged rate derive from this one
 * number; the only wedge between them is USD_QUOTE_MARGIN, applied at the
 * quoting layer (see `applyMarginPercent`).
 *
 * Serves the cached value while fresh; otherwise re-reads the window, with
 * concurrent callers sharing one in-flight request. When a recent read failed,
 * subsequent calls within `cacheTtlMs` serve the last-good value (or error)
 * without re-hitting upstream, so a degraded source is not hammered.
 *
 * Caching an average over days is not the compromise caching a spot price would
 * be: a minute of staleness cannot move a figure built from a week of fills.
 *
 * Returns `err(OracleUnavailableError)` when no trustworthy price is available;
 * `error.reason` says which guard closed the door, and the USDC payment path
 * is expected to stay shut until it opens.
 */
const getPrice = async (): Promise<
  Result<OraclePrice, OracleUnavailableError>
> => {
  const now = Date.now()
  if (cache && now < cache.expiresAt) {
    return ok({ ...cache.value, fromCache: true })
  }
  if (now < nextAttemptAt) {
    // Upstream was attempted recently and is degraded; serve the last-good
    // fallback (stale) rather than re-querying. The reason comes from the
    // CURRENT failure, never the retained history, so a long-recovered blip
    // cannot be reported as the thing closing the path.
    return serveStaleOrError(currentFailureReason ?? 'gateway')
  }
  if (inFlight) {
    return inFlight
  }
  inFlight = refresh()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

// Display-profile singletons. Held apart from the strict ones on purpose: the
// two profiles fail independently, and sharing either the cache or the retry
// throttle would let one path's outage decide the other's behaviour.
let displayCache: CacheEntry | null = null
let displayLastGood: OraclePrice | null = null
let displayNextAttemptAt = 0
let displayInFlight: Promise<
  Result<OraclePrice, OracleUnavailableError>
> | null = null
let displayFailureReason: OracleUnavailableReason | null = null

// The display profile's last-good fallback. A day's grace rather than the
// strict path's ten minutes — see `display.maxStaleMs`.
const serveStaleDisplayOrError = (
  failureReason: OracleUnavailableReason,
): Result<OraclePrice, OracleUnavailableError> => {
  if (
    displayLastGood &&
    Date.now() - displayLastGood.asOf.getTime() <
      config.priceOracle.display.maxStaleMs
  ) {
    return ok({ ...displayLastGood, fromCache: false, stale: true })
  }
  return err(
    new OracleUnavailableError(
      'Display price unavailable: the recent-swap window could not be used ' +
        `(${failureReason}), and no last-good estimate is within ` +
        `${config.priceOracle.display.maxStaleMs}ms`,
      failureReason,
    ),
  )
}

// Mirrors `refresh` for the display profile, including its containment of a
// thrown invariant: the statistics it calls throw rather than returning a
// Result, and an unhandled rejection here would reject every concurrent caller
// sharing the in-flight promise.
const refreshDisplay = async (): Promise<
  Result<OraclePrice, OracleUnavailableError>
> => {
  let window: Awaited<ReturnType<typeof buildDisplayWindow>>
  try {
    window = await internal.buildDisplayWindow()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(
      error,
      'Price oracle: unexpected failure building the display window',
    )
    window = err(
      unavailable(
        'the oracle itself failed while building the display window ' +
          `(${message}) — this is a bug in the oracle, not a condition ` +
          'upstream',
        'internal',
      ),
    )
  }
  displayNextAttemptAt = Date.now() + config.priceOracle.display.cacheTtlMs

  if (window.isErr()) {
    displayFailureReason = window.error.reason
    return serveStaleDisplayOrError(window.error.reason)
  }

  const value: OraclePrice = {
    usdPerAi3: window.value.usdPerAi3,
    asOf: new Date(),
    fromCache: false,
    stale: false,
  }
  displayCache = {
    value,
    expiresAt: Date.now() + config.priceOracle.display.cacheTtlMs,
  }
  displayLastGood = value
  displayFailureReason = null
  logger.debug(
    `Price oracle refreshed DISPLAY AI3/USD=${window.value.usdPerAi3.toString()} ` +
      `(scaled 1e18) from ${window.value.sampleCount} swaps`,
  )
  return ok(value)
}

/**
 * Current AI3/USD price for DISPLAY, as USD-per-AI3 scaled by 1e18.
 *
 * Same pool and same arithmetic as `getPrice`, judged by the display profile
 * (see `buildDisplayWindow` and `config.priceOracle.display`). Use it for any
 * figure a person reads and nobody is charged from; use `getPrice` for
 * anything that decides an amount of money.
 *
 * The two must never be swapped. Quoting a purchase from this one would charge
 * against a rate no guard defends, and it would do so silently, because the
 * number looks exactly like the strict one. That is the whole reason this is a
 * separate function with a separate name rather than a boolean argument.
 *
 * Its own cache, its own last-good and its own retry throttle, so a failing
 * display read cannot evict a good strict rate or throttle its refresh, and a
 * healthy strict rate cannot mask a display outage.
 */
const getDisplayPrice = async (): Promise<
  Result<OraclePrice, OracleUnavailableError>
> => {
  const now = Date.now()
  if (displayCache && now < displayCache.expiresAt) {
    return ok({ ...displayCache.value, fromCache: true })
  }
  if (now < displayNextAttemptAt) {
    return serveStaleDisplayOrError(displayFailureReason ?? 'gateway')
  }
  if (displayInFlight) {
    return displayInFlight
  }
  displayInFlight = refreshDisplay()
  try {
    return await displayInFlight
  } finally {
    displayInFlight = null
  }
}

/**
 * What the oracle currently knows, for the admin dashboard and the treasury
 * report.
 *
 * Deliberately a plain snapshot with no side effects: a status panel must never
 * be the thing that triggers an upstream read, or watching the dashboard would
 * change what the dashboard reports.
 */
const getHealth = (): OracleHealth => ({
  lastSuccessAt,
  lastFailureAt,
  lastFailureReason,
  window: lastWindow,
  // "The last attempt failed and there is still something to serve." Note this
  // cannot be inferred from `cache` being expired: a failed refresh leaves the
  // stale entry in place rather than evicting it, so an expired cache is the
  // normal state between reads, not a symptom. Keyed off the current failure
  // rather than the retained one, or the oracle would look degraded forever
  // after its first bad read.
  servingStale:
    currentFailureReason !== null &&
    lastGood !== null &&
    Date.now() - lastGood.asOf.getTime() < config.priceOracle.maxStaleMs,
})

// Clear all singleton state. Test-only (the service is a module singleton).
const reset = (): void => {
  cache = null
  lastGood = null
  nextAttemptAt = 0
  inFlight = null
  displayCache = null
  displayLastGood = null
  displayNextAttemptAt = 0
  displayInFlight = null
  displayFailureReason = null
  lastWindow = null
  lastSuccessAt = null
  lastFailureAt = null
  lastFailureReason = null
  currentFailureReason = null
}

export const priceOracle = {
  getPrice,
  getDisplayPrice,
  getHealth,
  // Internal collaborators exposed for unit tests (spy/override), matching the
  // `_`-prefixed convention used by paymentManager.
  _internal: internal,
  _refresh: refresh,
  _reset: reset,
}
