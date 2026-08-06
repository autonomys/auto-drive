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
  timeWeightedAverage,
} from './quote.js'
import {
  MAX_UINT128,
  fetchSwapPrices,
  fetchUniswapV4Quote,
  isQuoterRevert,
  readPoolQuote,
  readUsdPerAi3At,
  removePoolFee,
} from './uniswapV4.js'
import {
  InvalidQuoteAmountError,
  OracleUnavailableError,
  PoolEmptyError,
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

const maxSpotDiscountBps = parsePercentToBps(
  config.priceOracle.maxSpotDiscountPercent,
  'ORACLE_MAX_SPOT_DISCOUNT',
)
const maxSpotPremiumBps = parsePercentToBps(
  config.priceOracle.maxSpotPremiumPercent,
  'ORACLE_MAX_SPOT_PREMIUM',
)

// The total budget must exceed the per-request bound, or the race around a
// multi-call sequence always fires before any single request can time out —
// leaving the transport timeout as dead code and failing every quote against a
// healthy-but-slow RPC. Checked here rather than in config.ts so the message can
// name both variables.
if (config.priceOracle.fetchTimeoutMs <= config.priceOracle.rpcTimeoutMs) {
  throw new Error(
    `ORACLE_FETCH_TIMEOUT_MS (${config.priceOracle.fetchTimeoutMs}) must be ` +
      `greater than ORACLE_RPC_TIMEOUT_MS (${config.priceOracle.rpcTimeoutMs}) ` +
      '— it is the budget for a whole multi-call sequence, not for one request',
  )
}

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
// Time-weighted average price backing the manipulation gate (see
// checkPriceDeviation). Cached separately from `cache`, and for longer, because
// it is a 24h baseline rather than a price anyone is charged.
let twapReference: { value: bigint; expiresAt: number } | null = null

// A validated pool read: the price, plus the block it came from so it can be
// gated.
type ValidatedQuote = { usdPerAi3: bigint; blockNumber: bigint }

// Fetch a single validated AI3/USD quote (scaled 1e18), or null if the source
// failed, timed out, or returned an out-of-bounds / stale / untradeable value.
// Never throws. `fetchRaw` is injectable for tests; production reads the
// Uniswap v4 pool.
const fetchQuote = async (
  fetchRaw: (signal?: AbortSignal) => Promise<RawQuote> = fetchUniswapV4Quote,
): Promise<ValidatedQuote | null> => {
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
    // An empty pool still reports a price — the one the last swap left, with
    // nobody able to move it. It is not a rate anything should be charged at,
    // and the deviation gate cannot catch it: with no trades, spot and the
    // trailing average are the same standing number.
    if (raw.liquidity <= 0n) {
      logger.warn(
        'Price oracle: pool has no in-range liquidity at block ' +
          `${raw.blockNumber}; dropping the price it reports`,
      )
      return null
    }
    return { usdPerAi3: raw.usdPerAi3, blockNumber: raw.blockNumber }
  } catch (error) {
    logger.warn(
      'Price oracle: pool read failed: ' +
        `${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/**
 * Time-weighted average price over the window ending at `headBlock`.
 *
 * One archival state read for the price standing when the window opened, plus
 * the swap history inside it. The seed is not an edge case: this pool regularly
 * goes a full day without trading, and in that case it is the entire average.
 */
const buildTwapReference = async (headBlock: bigint): Promise<bigint> => {
  const windowBlocks = BigInt(config.priceOracle.twapWindowBlocks)
  const windowStart = headBlock > windowBlocks ? headBlock - windowBlocks : 0n
  const [seed, observations] = await Promise.all([
    internal.readUsdPerAi3At(windowStart),
    internal.fetchSwapPrices(
      windowStart + 1n,
      headBlock,
      config.priceOracle.twapLogChunkBlocks,
    ),
  ])
  return timeWeightedAverage(seed, observations, windowStart, headBlock)
}

// Grouped so unit tests can spy on the collaborators (jest.spyOn), mirroring how
// paymentManager exposes _viemClient. Not for use outside tests.
const internal = {
  fetchQuote,
  readPoolQuote,
  readUsdPerAi3At,
  fetchSwapPrices,
  buildTwapReference,
}

const signedDeviationBps = (value: bigint, reference: bigint): bigint =>
  ((value - reference) * BASIS_POINTS) / reference

/**
 * Refuse the price when it sits too far from the pool's trailing average.
 *
 * The pool has no oracle hook, so `getSlot0` is single-block spot state and a
 * swap in the block before ours moves it. The average built by
 * `buildTwapReference` is what makes that expensive: because it is weighted by
 * how long each price STOOD, a push has to be held for a large fraction of the
 * window to shift it, and a push in the block being read carries zero weight.
 *
 * Asymmetric on purpose. Spot below the average is the direction that
 * under-collects, and the only one an attacker profits from, so it is bounded
 * tightly. Spot above overcharges a user who can see the quote and decline, so
 * it is bounded loosely — a rail against integration error rather than a
 * manipulation control. Applying the tight bound to both directions would buy
 * nothing and cost availability on the revenue path: measured against 45 days of
 * this pool's real history, which includes a genuine 62% drawdown, a symmetric
 * 10% gate would have refused every quote for 21% of all hours.
 *
 * Skipped entirely when `ORACLE_TWAP_WINDOW_BLOCKS` is 0. Otherwise a failure to
 * build the reference is fatal to the caller rather than ignored — an RPC that
 * cannot serve the history would otherwise silently leave every price unguarded.
 */
const checkPriceDeviation = async (
  usdPerAi3: bigint,
  blockNumber: bigint,
): Promise<Result<void, OracleUnavailableError | PriceDeviationError>> => {
  if (config.priceOracle.twapWindowBlocks <= 0) {
    return ok(undefined)
  }

  // The average is over a day of history, so it moves far more slowly than spot
  // and does not need re-deriving per quote. Caching it does not weaken the
  // gate, which compares each caller's own fresh spot price against it.
  let reference: bigint
  if (twapReference && Date.now() < twapReference.expiresAt) {
    reference = twapReference.value
  } else {
    try {
      reference = await withTimeout(
        internal.buildTwapReference(blockNumber),
        config.priceOracle.fetchTimeoutMs,
        'priceOracle:twap',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`Price oracle: TWAP reference failed: ${message}`)
      return err(
        new OracleUnavailableError(
          'Price oracle unavailable: could not build the trailing average ' +
            `(${message})`,
        ),
      )
    }

    // A non-positive reference is an unusable baseline, not an infinite
    // deviation — and dividing by it would throw a bare RangeError straight out
    // of a function whose contract is to return a Result. Reachable without a
    // broken RPC: the price conversion truncates to zero for any sqrtPriceX96
    // below ~7.9e13, which is still far above v4's MIN_SQRT_PRICE.
    if (reference <= 0n) {
      logger.warn(
        'Price oracle: trailing average is zero; the pool history is unusable',
      )
      return err(
        new OracleUnavailableError(
          'Price oracle unavailable: the pool history yields a zero trailing ' +
            'average, so there is no baseline to judge the current price against',
        ),
      )
    }

    twapReference = {
      value: reference,
      expiresAt: Date.now() + config.priceOracle.twapTtlMs,
    }
  }

  const deviationBps = signedDeviationBps(usdPerAi3, reference)
  const limit = deviationBps < 0n ? maxSpotDiscountBps : maxSpotPremiumBps
  const magnitude = deviationBps < 0n ? -deviationBps : deviationBps
  if (magnitude > limit) {
    const side = deviationBps < 0n ? 'below' : 'above'
    logger.warn(
      `Price oracle: refusing to serve — spot ${usdPerAi3} sits ${magnitude}bps ` +
        `${side} the trailing average ${reference}, past the ${limit}bps limit`,
    )
    return err(
      new PriceDeviationError(
        `The pool price is ${magnitude} basis points ${side} its trailing ` +
          `average, past the ${limit} basis point limit`,
        deviationBps,
        reference,
      ),
    )
  }
  return ok(undefined)
}

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
  const quote = await internal.fetchQuote()
  // Throttle the next upstream attempt regardless of outcome, so a degraded
  // source is retried at most once per cacheTtlMs instead of on every request.
  nextAttemptAt = Date.now() + config.priceOracle.cacheTtlMs

  if (quote === null) {
    logger.warn('Price oracle: pool read unhealthy; serving last-good fallback')
    return serveStaleOrError()
  }

  // Gate this read before it is remembered. `cache` and `lastGood` both outlive
  // the block they were read at — lastGood by up to maxStaleMs — so an ungated
  // value would let a price that held for one block go on being served for ten
  // minutes after the push that produced it had decayed.
  const gated = await checkPriceDeviation(quote.usdPerAi3, quote.blockNumber)
  if (gated.isErr()) {
    logger.warn(
      `Price oracle: refusing to cache the price at block ${quote.blockNumber}: ` +
        `${gated.error.message}`,
    )
    return serveStaleOrError()
  }

  const value: OraclePrice = {
    usdPerAi3: quote.usdPerAi3,
    asOf: new Date(),
    fromCache: false,
    stale: false,
  }
  cache = { value, expiresAt: Date.now() + config.priceOracle.cacheTtlMs }
  lastGood = value
  logger.debug(
    `Price oracle refreshed AI3/USD=${quote.usdPerAi3.toString()} ` +
      '(scaled 1e18)',
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
 * This is the pool's *marginal* price: what an infinitesimal trade would pay,
 * not what a real conversion costs. Use it for display. For anything that will
 * actually be charged, use `getExecutableQuote`, which prices the specific size
 * and returns the rate to persist as `usd_rate_at_creation` — deriving that rate
 * from here instead would store a number the pool was never asked to honour at
 * the intent's size.
 *
 * It passes the same manipulation gate as an executable quote, applied before
 * anything is written to `cache` or `lastGood`; a price that fails it is never
 * remembered, and the caller sees the previous good value (or an error) instead.
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
 * Slippage is PRICED IN, not refused. `usdcAmount` is what converting this size
 * actually costs, and `priceImpactBps` reports how much of that is the size's
 * own doing. Deciding whether a size is allowed belongs upstream, where the
 * per-user credit cap is enforced before an intent exists — the oracle prices
 * what it is handed.
 *
 * Failure modes are deliberately distinct:
 *  - `QuoteTooLargeError`      the pool has no liquidity to fill it
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
    // Each RPC request is bounded by the transport timeout in uniswapV4.ts;
    // this bounds how long a caller waits for the whole multi-call sequence, so
    // a wedged client cannot hold an intent open indefinitely. It does not abort
    // anything — a request this race gives up on still runs to completion.
    observation = await withTimeout(
      internal.readPoolQuote(ai3Shannons),
      config.priceOracle.fetchTimeoutMs,
      'priceOracle:quoter',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // An empty pool reverts exactly like an oversized trade, so it is separated
    // by the liquidity read rather than by the revert. Checked first: telling a
    // user to buy less when no size at all can be filled is advice that cannot
    // work, and it would hide a total outage behind a user-facing error.
    if (error instanceof PoolEmptyError) {
      logger.warn(`Price oracle: ${message}`)
      return err(
        new OracleUnavailableError(`Price oracle unavailable: ${message}`),
      )
    }
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

  // Liquidity is not re-checked here: the adapter throws `PoolEmptyError` before
  // returning an observation from an empty pool, handled above.
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
  const deviationResult = await checkPriceDeviation(usdPerAi3, blockNumber)
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
  // regardless of size. Reporting slippage against it would put a constant
  // floor under the figure and describe something other than what this size
  // costs. The fee is the one read at the same block, not the static
  // POOL_KEY.fee.
  const quotePremiumBps =
    ((amountIn - marginalCost) * BASIS_POINTS) / marginalCost
  const netOfFee = removePoolFee(amountIn, feePips)
  const rawImpactBps = ((netOfFee - marginalCost) * BASIS_POINTS) / marginalCost
  // Integer division of the fee can leave the net a base unit under the
  // marginal cost on tiny amounts; a negative premium is not meaningful.
  const priceImpactBps = rawImpactBps > 0n ? rawImpactBps : 0n

  // Slippage is reported, never a reason to refuse: `usdcAmount` already
  // carries it, and whether a size is allowed was settled upstream against the
  // per-user credit cap.
  if (priceImpactBps > 0n) {
    logger.debug(
      `Price oracle: quoted ${ai3Shannons} shannons at ${amountIn} USDC ` +
        `(${priceImpactBps}bps slippage, ${quotePremiumBps}bps over spot)`,
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
  twapReference = null
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
