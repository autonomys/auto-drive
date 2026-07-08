import { err, ok, Result } from 'neverthrow'
import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import { withTimeout } from '../../../shared/utils/index.js'
import {
  isQuoteFresh,
  isWithinBounds,
  median,
  parseDecimalToScaledBigint,
} from './aggregate.js'
import { resolveSources } from './sources.js'
import {
  OracleUnavailableError,
  type OraclePrice,
  type PriceSourceAdapter,
  type SourceQuote,
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
// - `cache`        last successful fresh price, valid until expiresAt.
// - `lastGood`     last successful price, served (as stale) during an outage.
// - `nextAttemptAt` earliest time we may hit upstream again; set after EVERY
//                  refresh attempt so a degraded upstream is retried at most
//                  once per cacheTtlMs rather than on every request.
// - `inFlight`     collapses concurrent refreshes into one upstream round-trip.
let cache: CacheEntry | null = null
let lastGood: OraclePrice | null = null
let nextAttemptAt = 0
let inFlight: Promise<Result<OraclePrice, OracleUnavailableError>> | null = null

// Fetch the given sources concurrently, scale + validate each, and return one
// SourceQuote per source. A failed or rejected source yields ok:false rather
// than rejecting the whole batch. `adapters` is injectable for tests; production
// callers use the configured registry.
const fetchSources = async (
  adapters: PriceSourceAdapter[] = resolveSources(config.priceOracle.sources),
): Promise<SourceQuote[]> => {
  const now = Date.now()
  return Promise.all(
    adapters.map(async (source): Promise<SourceQuote> => {
      const dropped: SourceQuote = {
        name: source.name,
        usdPerAi3: null,
        ok: false,
      }
      // Abort the underlying request when the timeout fires so a slow source
      // does not leak a socket that outlives its usefulness.
      const controller = new AbortController()
      try {
        const raw = await withTimeout(
          source.fetch(controller.signal),
          config.priceOracle.fetchTimeoutMs,
          `priceOracle:${source.name}`,
          controller,
        )
        if (!isWithinBounds(raw.usdPerAi3, minScaled, maxScaled)) {
          logger.warn(
            `Price oracle source ${source.name} returned out-of-bounds ` +
              `price ${raw.usdPerAi3.toString()} (scaled 1e18); dropping`,
          )
          return dropped
        }
        if (
          raw.asOfMs !== undefined &&
          !isQuoteFresh(raw.asOfMs, now, config.priceOracle.maxSourceAgeMs)
        ) {
          logger.warn(
            `Price oracle source ${source.name} returned a stale quote ` +
              `(asOf ${raw.asOfMs}); dropping`,
          )
          return dropped
        }
        return { name: source.name, usdPerAi3: raw.usdPerAi3, ok: true }
      } catch (error) {
        logger.warn(
          `Price oracle source ${source.name} failed: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        )
        return dropped
      }
    }),
  )
}

// Collaborators grouped so unit tests can spy on them (jest.spyOn), mirroring
// how paymentManager exposes _viemClient. Not for use outside tests.
const internal = { fetchSources }

// Serve the last good price as a stale fallback, or error if none is fresh
// enough. `sources` is the breakdown of the just-attempted refresh, or [] when
// the caller was throttled and made no attempt.
const serveStaleOrError = (
  fromCache: boolean,
  sources: SourceQuote[],
): Result<OraclePrice, OracleUnavailableError> => {
  if (
    lastGood &&
    Date.now() - lastGood.asOf.getTime() < config.priceOracle.maxStaleMs
  ) {
    return ok({ ...lastGood, fromCache, stale: true, sources })
  }
  return err(
    new OracleUnavailableError(
      'Price oracle unavailable: no healthy source and no last-good value ' +
        `within ${config.priceOracle.maxStaleMs}ms`,
    ),
  )
}

// Refresh from the sources, updating cache + last-good on success. Always
// resolves (never rejects) so the neverthrow contract holds.
const refresh = async (): Promise<
  Result<OraclePrice, OracleUnavailableError>
> => {
  let sources: SourceQuote[]
  try {
    sources = await internal.fetchSources()
  } catch (error) {
    // fetchSources is designed never to reject; this guards the Result contract
    // against future changes so an unexpected throw cannot bypass neverthrow.
    nextAttemptAt = Date.now() + config.priceOracle.cacheTtlMs
    logger.error(
      error instanceof Error ? error : new Error(String(error)),
      'Price oracle refresh threw unexpectedly',
    )
    return serveStaleOrError(false, [])
  }

  // Throttle the next upstream attempt regardless of outcome, so a degraded
  // source is retried at most once per cacheTtlMs instead of on every request.
  nextAttemptAt = Date.now() + config.priceOracle.cacheTtlMs

  const healthy = sources
    .map((source) => source.usdPerAi3)
    .filter((value): value is bigint => value !== null)

  if (healthy.length < config.priceOracle.minSources) {
    logger.warn(
      `Price oracle: ${healthy.length}/${config.priceOracle.minSources} ` +
        'healthy source(s); attempting last-good fallback',
    )
    return serveStaleOrError(false, sources)
  }

  const value: OraclePrice = {
    usdPerAi3: median(healthy),
    asOf: new Date(),
    fromCache: false,
    stale: false,
    sources,
  }
  cache = { value, expiresAt: Date.now() + config.priceOracle.cacheTtlMs }
  lastGood = value
  logger.debug(
    `Price oracle refreshed AI3/USD=${value.usdPerAi3.toString()} ` +
      `(scaled 1e18) from ${healthy.length} source(s)`,
  )
  return ok(value)
}

/**
 * Current AI3/USD price as USD-per-AI3 scaled by USD_RATE_SCALE (1e18).
 *
 * Serves the cached value while fresh; otherwise refreshes from the configured
 * sources, with concurrent callers sharing one in-flight request. When a recent
 * refresh failed, subsequent calls within `cacheTtlMs` serve the last-good value
 * (or error) without re-hitting upstream, so a degraded source is not hammered.
 * Returns `err(OracleUnavailableError)` when no trustworthy price is available.
 */
const getPrice = async (): Promise<
  Result<OraclePrice, OracleUnavailableError>
> => {
  const now = Date.now()
  if (cache && now < cache.expiresAt) {
    return ok({ ...cache.value, fromCache: true, sources: [] })
  }
  if (now < nextAttemptAt) {
    // Upstream was attempted recently and is degraded; don't hit it again yet.
    return serveStaleOrError(true, [])
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
