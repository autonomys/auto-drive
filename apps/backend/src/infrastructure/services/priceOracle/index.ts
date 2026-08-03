import { err, ok, Result } from 'neverthrow'
import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import {
  ai3ShannonsToUsdcBaseUnits,
  withTimeout,
} from '../../../shared/utils/index.js'
import {
  isQuoteFresh,
  isWithinBounds,
  parseDecimalToScaledBigint,
} from './quote.js'
import {
  MAX_UINT128,
  fetchUniswapV4Quote,
  isQuoterRevert,
  readPoolQuote,
  removePoolFee,
  sampleUsdPerAi3,
} from './uniswapV4.js'
import {
  InvalidQuoteAmountError,
  OracleUnavailableError,
  PriceDeviationError,
  QuoteTooLargeError,
  type ExecutableQuote,
  type OraclePrice,
  type RawQuote,
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

const BASIS_POINTS = 10_000n

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

const maxPriceImpactBps = parsePercentToBps(
  config.priceOracle.maxPriceImpactPercent,
  'ORACLE_MAX_PRICE_IMPACT',
)
const maxSpotDeviationBps = parsePercentToBps(
  config.priceOracle.maxSpotDeviationPercent,
  'ORACLE_MAX_SPOT_DEVIATION',
)

type CacheEntry = { value: OraclePrice; expiresAt: number }

// Module-level singleton state (same shape as paymentManager):
// - `cache`         last successful fresh price, valid until expiresAt.
// - `lastGood`      last successful price, served (as stale) during an outage.
// - `nextAttemptAt` earliest time we may read the pool again; set after EVERY
//                   fetch attempt so a degraded upstream is retried at most once
//                   per cacheTtlMs rather than on every request.
// - `inFlight`      collapses concurrent refreshes into one upstream round-trip.
let cache: CacheEntry | null = null
let lastGood: OraclePrice | null = null
let nextAttemptAt = 0
let inFlight: Promise<Result<OraclePrice, OracleUnavailableError>> | null = null
// Median of historical samples backing the spot-deviation gate (see
// checkSpotDeviation). Cached separately from `cache` because it is a slow
// baseline, not a price anyone is charged.
let spotReference: { value: bigint; expiresAt: number } | null = null

// Fetch a single validated AI3/USD quote (scaled 1e18), or null if the source
// failed, timed out, or returned an out-of-bounds / stale value. Never throws.
// `fetchRaw` is injectable for tests; production reads the Uniswap v4 pool.
const fetchQuote = async (
  fetchRaw: (signal?: AbortSignal) => Promise<RawQuote> = fetchUniswapV4Quote,
): Promise<bigint | null> => {
  // The signal is offered to `fetchRaw` for sources that can honour one; the
  // production adapter cannot, because viem's actions take no AbortSignal — its
  // requests are bounded by the transport timeout instead. `withTimeout` is what
  // bounds this call either way.
  const controller = new AbortController()
  try {
    const raw = await withTimeout(
      fetchRaw(controller.signal),
      config.priceOracle.fetchTimeoutMs,
      'priceOracle:uniswapV4',
      controller,
    )
    if (!isWithinBounds(raw.usdPerAi3, minScaled, maxScaled)) {
      logger.warn(
        'Price oracle: pool returned out-of-bounds price ' +
          `${raw.usdPerAi3.toString()} (scaled 1e18); dropping`,
      )
      return null
    }
    if (
      raw.asOfMs !== undefined &&
      !isQuoteFresh(raw.asOfMs, Date.now(), config.priceOracle.maxSourceAgeMs)
    ) {
      logger.warn(
        `Price oracle: pool state is stale (block time ${raw.asOfMs}); ` +
          'dropping',
      )
      return null
    }
    return raw.usdPerAi3
  } catch (error) {
    logger.warn(
      'Price oracle: pool read failed: ' +
        `${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

// Grouped so unit tests can spy on the fetch (jest.spyOn), mirroring how
// paymentManager exposes _viemClient. Not for use outside tests.
const internal = { fetchQuote, readPoolQuote, sampleUsdPerAi3 }

// Serve the last good price as a stale fallback, or error if none is fresh
// enough.
const serveStaleOrError = (): Result<OraclePrice, OracleUnavailableError> => {
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
      'Price oracle unavailable: the pool could not be read and there is no ' +
        `last-good value within ${config.priceOracle.maxStaleMs}ms`,
    ),
  )
}

// Refresh from the pool, updating cache + last-good on success. Always resolves
// (never rejects) so the neverthrow contract holds — fetchQuote absorbs errors.
const refresh = async (): Promise<
  Result<OraclePrice, OracleUnavailableError>
> => {
  const usdPerAi3 = await internal.fetchQuote()
  // Throttle the next upstream attempt regardless of outcome, so a degraded
  // source is retried at most once per cacheTtlMs instead of on every request.
  nextAttemptAt = Date.now() + config.priceOracle.cacheTtlMs

  if (usdPerAi3 === null) {
    logger.warn('Price oracle: pool read unhealthy; serving last-good fallback')
    return serveStaleOrError()
  }

  const value: OraclePrice = {
    usdPerAi3,
    asOf: new Date(),
    fromCache: false,
    stale: false,
  }
  cache = { value, expiresAt: Date.now() + config.priceOracle.cacheTtlMs }
  lastGood = value
  logger.debug(
    `Price oracle refreshed AI3/USD=${usdPerAi3.toString()} (scaled 1e18)`,
  )
  return ok(value)
}

/**
 * Current AI3/USD price as USD-per-AI3 scaled by USD_RATE_SCALE (1e18).
 *
 * Serves the cached value while fresh; otherwise re-reads the pool, with
 * concurrent callers sharing one in-flight request. When a recent read failed,
 * subsequent calls within `cacheTtlMs` serve the last-good value (or error)
 * without re-hitting upstream, so a degraded source is not hammered. Returns
 * `err(OracleUnavailableError)` when no trustworthy price is available.
 *
 * This is the pool's *marginal* price. For anything that will actually be
 * converted, prefer `getExecutableQuote`, which prices the specific size.
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
    // fallback (stale) rather than re-reading the pool.
    return serveStaleOrError()
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

/**
 * Smallest marginal cost (USDC base units, so this is $0.01) an amount may have
 * and still be quotable.
 *
 * Not a business minimum — a numerical one. Price impact is a ratio against the
 * marginal cost, so at a marginal cost of a few base units a single unit of
 * integer rounding is worth thousands of basis points and the depth guard would
 * reject or admit essentially at random. At $0.01 one base unit is 1bps, which
 * is below any threshold worth setting.
 */
const MIN_QUOTABLE_USDC = 10_000n

export type ExecutableQuoteError =
  | OracleUnavailableError
  | QuoteTooLargeError
  | InvalidQuoteAmountError
  | PriceDeviationError

// Median of a non-empty list. Chosen over a mean because it is what makes a
// single manipulated sample inert: one outlier moves a mean, but cannot move a
// median past its neighbours.
const median = (values: bigint[]): bigint => {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2n
}

const absDeviationBps = (value: bigint, reference: bigint): bigint => {
  const delta = value > reference ? value - reference : reference - value
  return (delta * BASIS_POINTS) / reference
}

/**
 * Refuse the quote when the pool's current price is far from its recent median.
 *
 * The pool has no oracle hook, so `getSlot0` is single-block spot state and a
 * swap in the block before ours moves it. Sampling earlier blocks is the closest
 * thing to a TWAP available here: a price pushed for one block stands out
 * against the median of the samples, while genuine drift carries the samples
 * with it.
 *
 * Skipped when sampling is disabled (`ORACLE_SPOT_SAMPLES` <= 1). A sampling
 * failure is fatal to the quote rather than ignored — an RPC without state at
 * that depth would otherwise silently leave every quote unguarded.
 */
const checkSpotDeviation = async (
  usdPerAi3: bigint,
  blockNumber: bigint,
): Promise<Result<void, OracleUnavailableError | PriceDeviationError>> => {
  const { spotSampleCount, spotSampleSpacingBlocks } = config.priceOracle
  if (spotSampleCount <= 1) {
    return ok(undefined)
  }

  // The reference is a median over blocks that are already minutes old, so it
  // moves far more slowly than spot. Caching it for the same TTL as the price
  // keeps a burst of quotes from issuing `spotSampleCount` archival reads each
  // — the bulk of this path's RPC cost — without weakening the gate, which
  // compares each quote's own fresh spot price against it.
  let reference: bigint
  if (spotReference && Date.now() < spotReference.expiresAt) {
    reference = spotReference.value
  } else {
    let samples: bigint[]
    try {
      samples = await withTimeout(
        internal.sampleUsdPerAi3(
          blockNumber,
          spotSampleCount,
          spotSampleSpacingBlocks,
        ),
        config.priceOracle.fetchTimeoutMs,
        'priceOracle:spotSamples',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`Price oracle: spot sampling failed: ${message}`)
      return err(
        new OracleUnavailableError(
          'Price oracle unavailable: could not sample historical pool state ' +
            `(${message})`,
        ),
      )
    }

    if (samples.length < 2) {
      // Too little history to form a reference — e.g. a pool near genesis, whose
      // pre-initialisation blocks the adapter drops.
      return ok(undefined)
    }

    reference = median(samples)
    spotReference = {
      value: reference,
      expiresAt: Date.now() + config.priceOracle.cacheTtlMs,
    }
  }

  const deviationBps = absDeviationBps(usdPerAi3, reference)
  if (deviationBps > maxSpotDeviationBps) {
    logger.warn(
      `Price oracle: refusing to quote — spot ${usdPerAi3} deviates ` +
        `${deviationBps}bps from the sampled median ` +
        `${reference}, above the ${maxSpotDeviationBps}bps limit`,
    )
    return err(
      new PriceDeviationError(
        `The pool price moved ${deviationBps} basis points away from its ` +
          `recent median, above the ${maxSpotDeviationBps} basis point limit`,
        deviationBps,
      ),
    )
  }
  return ok(undefined)
}

/**
 * Price a specific conversion: how much USDC it takes to acquire `ai3Shannons`
 * of AI3 from the pool, and how far that trade moves the pool.
 *
 * Why this exists rather than multiplying `getPrice()` by the size: the marginal
 * price only describes an infinitesimal trade. A real conversion walks the
 * liquidity curve, so on a shallow pool the executable cost can sit well above
 * `size × marginal price`. Quoting the marginal price and converting at the
 * executable one silently absorbs that difference on every purchase.
 *
 * Unlike `getPrice`, this never serves a cached or stale price. It backs a
 * binding charge, and the marginal price and the quoter result are only
 * comparable when read at the same block — a cached marginal price against a
 * live quote measures elapsed drift as much as it measures slippage.
 *
 * Failure modes are deliberately distinct:
 *  - `QuoteTooLargeError`      reduce the amount
 *  - `InvalidQuoteAmountError` the amount is unquotable on its own terms
 *  - `PriceDeviationError`     the pool's price is not currently trustworthy
 *  - `OracleUnavailableError`  we could not reach the chain to find out
 */
const getExecutableQuote = async (
  ai3Shannons: bigint,
): Promise<Result<ExecutableQuote, ExecutableQuoteError>> => {
  // The width check is duplicated from the adapter so an out-of-range amount is
  // reported as an invalid amount, not surfaced through the adapter's throw as
  // an oracle outage.
  if (ai3Shannons <= 0n || ai3Shannons > MAX_UINT128) {
    return err(
      new InvalidQuoteAmountError(`Unquotable AI3 amount: ${ai3Shannons}`),
    )
  }

  let observation: Awaited<ReturnType<typeof readPoolQuote>>
  try {
    // The individual RPC requests are bounded by the transport timeout in
    // uniswapV4.ts; this races the whole multi-call sequence so a wedged client
    // cannot hold an intent open indefinitely.
    observation = await withTimeout(
      internal.readPoolQuote(ai3Shannons),
      config.priceOracle.fetchTimeoutMs,
      'priceOracle:quoter',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Only an on-chain revert means the pool genuinely cannot fill the size. RPC
    // failures, timeouts and misconfiguration mean we could not find out, and
    // reporting those as "too large" would blame the buyer for our outage.
    if (isQuoterRevert(error)) {
      logger.warn(
        `Price oracle: quoter reverted for ${ai3Shannons} shannons: ${message}`,
      )
      return err(
        new QuoteTooLargeError(
          `The pool cannot fill ${ai3Shannons} shannons of AI3`,
        ),
      )
    }
    logger.warn(`Price oracle: quote read failed: ${message}`)
    return err(
      new OracleUnavailableError(
        `Price oracle unavailable: the pool could not be quoted (${message})`,
      ),
    )
  }

  const { usdPerAi3, amountIn, feePips, blockNumber, asOfMs } = observation

  if (!isWithinBounds(usdPerAi3, minScaled, maxScaled)) {
    return err(
      new OracleUnavailableError(
        `Price oracle unavailable: pool price ${usdPerAi3} (scaled 1e18) is ` +
          'outside the configured bounds',
      ),
    )
  }
  if (!isQuoteFresh(asOfMs, Date.now(), config.priceOracle.maxSourceAgeMs)) {
    return err(
      new OracleUnavailableError(
        `Price oracle unavailable: pool state at block ${blockNumber} is stale`,
      ),
    )
  }

  // Manipulation gate. Runs before the cost is trusted, so a price pushed in the
  // block we read never reaches a quote.
  const deviationResult = await checkSpotDeviation(usdPerAi3, blockNumber)
  if (deviationResult.isErr()) {
    return err(deviationResult.error)
  }

  const marginalCost = ai3ShannonsToUsdcBaseUnits(ai3Shannons, usdPerAi3)
  if (marginalCost < MIN_QUOTABLE_USDC) {
    return err(
      new InvalidQuoteAmountError(
        `AI3 amount ${ai3Shannons} prices at ${marginalCost} USDC base units, ` +
          `below the ${MIN_QUOTABLE_USDC} minimum needed to quote it`,
      ),
    )
  }

  // A real quote can never cost less than the spot value of what it buys: the
  // swap fee and the trade's own impact both push it up. If it does, we have
  // misread the quoter — a transposed return value, an ABI drift, a wrong
  // decimal — and the number is about to become a binding undercharge. Refuse
  // rather than trust it; the guard below only catches quotes that are too
  // expensive, so without this the arithmetic is one-sided.
  if (amountIn <= marginalCost) {
    logger.warn(
      `Price oracle: implausible quote for ${ai3Shannons} shannons — ` +
        `${amountIn} USDC is at or below the ${marginalCost} spot value`,
    )
    return err(
      new OracleUnavailableError(
        `Price oracle unavailable: the pool quoted ${amountIn} USDC base ` +
          `units against a spot value of ${marginalCost}, which cannot be right`,
      ),
    )
  }

  // The quoter's amountIn is gross of the swap fee, which every trade pays
  // regardless of size. Measuring against it would put a constant floor under
  // the number and make the limit mean something other than depth. The fee is
  // the one read at the same block, not the static POOL_KEY.fee.
  const quotePremiumBps =
    ((amountIn - marginalCost) * BASIS_POINTS) / marginalCost
  const netOfFee = removePoolFee(amountIn, feePips)
  const rawImpactBps = ((netOfFee - marginalCost) * BASIS_POINTS) / marginalCost
  // Integer division of the fee can leave the net a base unit under the
  // marginal cost on tiny amounts; a negative premium is not meaningful.
  const priceImpactBps = rawImpactBps > 0n ? rawImpactBps : 0n

  if (priceImpactBps > maxPriceImpactBps) {
    logger.warn(
      `Price oracle: rejecting quote for ${ai3Shannons} shannons — execution ` +
        `premium ${priceImpactBps}bps exceeds the ${maxPriceImpactBps}bps limit`,
    )
    return err(
      new QuoteTooLargeError(
        `Converting this amount would cost ${priceImpactBps} basis points ` +
          `above spot, over the ${maxPriceImpactBps} basis point limit`,
        priceImpactBps,
      ),
    )
  }

  return ok({
    usdcAmount: amountIn,
    usdPerAi3,
    priceImpactBps,
    quotePremiumBps,
    ai3Shannons,
    blockNumber,
    asOf: new Date(asOfMs),
  })
}

// Clear all singleton state. Test-only (the service is a module singleton).
const reset = (): void => {
  cache = null
  lastGood = null
  nextAttemptAt = 0
  inFlight = null
  spotReference = null
}

export const priceOracle = {
  getPrice,
  getExecutableQuote,
  // Internal collaborators exposed for unit tests (spy/override), matching the
  // `_`-prefixed convention used by paymentManager.
  _internal: internal,
  _refresh: refresh,
  _reset: reset,
}
