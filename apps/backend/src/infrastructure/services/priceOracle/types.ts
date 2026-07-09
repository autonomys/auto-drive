/**
 * Types for the AI3/USD price oracle (see ./index.ts).
 *
 * All USD-per-AI3 values are integers scaled by USD_RATE_SCALE (1e18) — the
 * same representation persisted as `intents.usdRateAtCreation` — so downstream
 * USDC quote math stays integer-only. See @auto-drive/models `intent.ts`.
 */

// One source's contribution to a refresh, retained for observability (logs and
// the future daily treasury report). `usdPerAi3` is null when the source failed
// to fetch/parse or was rejected by the sanity/staleness guards.
export type SourceQuote = {
  name: string
  usdPerAi3: bigint | null
  ok: boolean
}

// Aggregated price returned to callers.
export type OraclePrice = {
  // Median USD-per-AI3 across healthy sources, scaled by USD_RATE_SCALE (1e18).
  usdPerAi3: bigint
  // When the value was computed (the original computation time when served as a
  // last-good fallback).
  asOf: Date
  // True only for a fresh in-memory TTL cache hit; always false for a stale
  // last-good fallback (see `stale`) and for a freshly fetched value.
  fromCache: boolean
  // Served from the last-good fallback because the latest refresh could not
  // gather enough healthy sources (still within maxStaleMs).
  stale: boolean
  // Per-source breakdown for the refresh that produced this value (empty on a
  // pure cache hit).
  sources: SourceQuote[]
}

// Scaled quote produced by a source adapter before aggregation.
export type RawQuote = {
  // USD-per-AI3 scaled by USD_RATE_SCALE (1e18).
  usdPerAi3: bigint
  // Epoch milliseconds the source last updated the quote, when exposed by the
  // API; used to drop stale per-source quotes. Undefined when not reported.
  asOfMs?: number
}

export type PriceSourceAdapter = {
  name: string
  // `signal` aborts the underlying request when the oracle's fetch timeout fires.
  fetch: (signal?: AbortSignal) => Promise<RawQuote>
}

// Wrapped in a neverthrow `err` when a refresh cannot gather at least
// `minSources` healthy quotes and there is no last-good value within
// `maxStaleMs` — i.e. USDC quoting cannot safely proceed right now.
export class OracleUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OracleUnavailableError'
  }
}
