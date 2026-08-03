/**
 * Types for the AI3/USD price oracle (see ./index.ts).
 *
 * All USD-per-AI3 values are integers scaled by USD_RATE_SCALE (1e18) — the
 * same representation persisted as `intents.usdRateAtCreation` — so downstream
 * USDC quote math stays integer-only. See @auto-drive/models `intent.ts`.
 */

// Price returned to callers.
export type OraclePrice = {
  // AI3/USD price scaled by USD_RATE_SCALE (1e18).
  usdPerAi3: bigint
  // When the value was fetched (the original fetch time when served as a
  // last-good fallback).
  asOf: Date
  // True only for a fresh in-memory TTL cache hit; always false for a stale
  // last-good fallback (see `stale`) and for a freshly fetched value.
  fromCache: boolean
  // Served from the last-good fallback because the latest fetch failed (still
  // within maxStaleMs).
  stale: boolean
}

// Scaled quote produced by the source adapter before validation.
export type RawQuote = {
  // AI3/USD price scaled by USD_RATE_SCALE (1e18).
  usdPerAi3: bigint
  // Epoch milliseconds the source last updated the quote, when exposed by the
  // API; used to drop stale quotes. Undefined when not reported.
  asOfMs?: number
}

/**
 * Size-aware cost of converting a specific intent, from the v4 Quoter.
 *
 * `usdcAmount` is what the conversion would actually execute at; `usdPerAi3` is
 * the pool's marginal price at the same moment (what gets persisted as the
 * intent's locked rate). `priceImpactBps` is the gap between them, i.e. how far
 * this trade alone moves the pool.
 */
export type ExecutableQuote = {
  // USDC base units (6 decimals) required to acquire the requested AI3.
  usdcAmount: bigint
  // Marginal AI3/USD price, scaled by USD_RATE_SCALE (1e18).
  usdPerAi3: bigint
  // (executable cost / marginal cost - 1), in basis points.
  priceImpactBps: bigint
}

// Wrapped in a neverthrow `err` when a fetch fails and there is no last-good
// value within `maxStaleMs` — i.e. USDC quoting cannot safely proceed right now.
export class OracleUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OracleUnavailableError'
  }
}

/**
 * The requested purchase is too large for the pool to absorb: converting it
 * would move the price by more than `maxPriceImpactBps`, or the pool cannot fill
 * the size at all.
 *
 * This is the depth guard. Without it, a purchase large relative to pool
 * liquidity is quoted at the marginal price but converted at a far worse average
 * one, and the shortfall is absorbed silently.
 */
export class QuoteTooLargeError extends Error {
  constructor(
    message: string,
    // Undefined when the pool could not fill the size at all, so no impact was
    // measurable.
    readonly priceImpactBps?: bigint,
  ) {
    super(message)
    this.name = 'QuoteTooLargeError'
  }
}
