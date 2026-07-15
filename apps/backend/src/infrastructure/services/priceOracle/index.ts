import { err, ok, Result } from 'neverthrow'
import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import { withTimeout } from '../../../shared/utils/index.js'
import {
  isQuoteFresh,
  isWithinBounds,
  parseDecimalToScaledBigint,
} from './quote.js'
import { fetchCoingeckoQuote } from './coingecko.js'
import {
  OracleUnavailableError,
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

type CacheEntry = { value: OraclePrice; expiresAt: number }

// Module-level singleton state (same shape as paymentManager):
// - `cache`         last successful fresh price, valid until expiresAt.
// - `lastGood`      last successful price, served (as stale) during an outage.
// - `nextAttemptAt` earliest time we may hit CoinGecko again; set after EVERY
//                   fetch attempt so a degraded upstream is retried at most once
//                   per cacheTtlMs rather than on every request.
// - `inFlight`      collapses concurrent refreshes into one upstream round-trip.
let cache: CacheEntry | null = null
let lastGood: OraclePrice | null = null
let nextAttemptAt = 0
let inFlight: Promise<Result<OraclePrice, OracleUnavailableError>> | null = null

// Fetch a single validated AI3/USD quote (scaled 1e18), or null if the source
// failed, timed out, or returned an out-of-bounds / stale value. Never throws.
// `fetchRaw` is injectable for tests; production uses the CoinGecko adapter.
const fetchQuote = async (
  fetchRaw: (signal?: AbortSignal) => Promise<RawQuote> = fetchCoingeckoQuote,
): Promise<bigint | null> => {
  // Abort the underlying request when the timeout fires so a slow source does
  // not leak a socket that outlives its usefulness.
  const controller = new AbortController()
  try {
    const raw = await withTimeout(
      fetchRaw(controller.signal),
      config.priceOracle.fetchTimeoutMs,
      'priceOracle:coingecko',
      controller,
    )
    if (!isWithinBounds(raw.usdPerAi3, minScaled, maxScaled)) {
      logger.warn(
        'Price oracle: CoinGecko returned out-of-bounds price ' +
          `${raw.usdPerAi3.toString()} (scaled 1e18); dropping`,
      )
      return null
    }
    if (
      raw.asOfMs !== undefined &&
      !isQuoteFresh(raw.asOfMs, Date.now(), config.priceOracle.maxSourceAgeMs)
    ) {
      logger.warn(
        `Price oracle: CoinGecko returned a stale quote (asOf ${raw.asOfMs}); ` +
          'dropping',
      )
      return null
    }
    return raw.usdPerAi3
  } catch (error) {
    logger.warn(
      'Price oracle: CoinGecko fetch failed: ' +
        `${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

// Grouped so unit tests can spy on the fetch (jest.spyOn), mirroring how
// paymentManager exposes _viemClient. Not for use outside tests.
const internal = { fetchQuote }

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
      'Price oracle unavailable: CoinGecko is unhealthy and there is no ' +
        `last-good value within ${config.priceOracle.maxStaleMs}ms`,
    ),
  )
}

// Refresh from CoinGecko, updating cache + last-good on success. Always resolves
// (never rejects) so the neverthrow contract holds — fetchQuote absorbs errors.
const refresh = async (): Promise<
  Result<OraclePrice, OracleUnavailableError>
> => {
  const usdPerAi3 = await internal.fetchQuote()
  // Throttle the next upstream attempt regardless of outcome, so a degraded
  // source is retried at most once per cacheTtlMs instead of on every request.
  nextAttemptAt = Date.now() + config.priceOracle.cacheTtlMs

  if (usdPerAi3 === null) {
    logger.warn('Price oracle: CoinGecko unhealthy; serving last-good fallback')
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
 * Serves the cached value while fresh; otherwise refreshes from CoinGecko, with
 * concurrent callers sharing one in-flight request. When a recent fetch failed,
 * subsequent calls within `cacheTtlMs` serve the last-good value (or error)
 * without re-hitting upstream, so a degraded source is not hammered. Returns
 * `err(OracleUnavailableError)` when no trustworthy price is available.
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
    // fallback (stale) rather than hitting CoinGecko again.
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

// Clear all singleton state. Test-only (the service is a module singleton).
const reset = (): void => {
  cache = null
  lastGood = null
  nextAttemptAt = 0
  inFlight = null
}

export const priceOracle = {
  getPrice,
  // Internal collaborators exposed for unit tests (spy/override), matching the
  // `_`-prefixed convention used by paymentManager.
  _internal: internal,
  _refresh: refresh,
  _reset: reset,
}
