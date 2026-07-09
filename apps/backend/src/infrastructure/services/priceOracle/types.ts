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

// Wrapped in a neverthrow `err` when a fetch fails and there is no last-good
// value within `maxStaleMs` — i.e. USDC quoting cannot safely proceed right now.
export class OracleUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OracleUnavailableError'
  }
}
