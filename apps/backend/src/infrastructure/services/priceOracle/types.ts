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
 * Every field describes the same block: `usdcAmount` is what the conversion
 * would execute at, `usdPerAi3` is the pool's marginal price at that same
 * block (what gets persisted as the intent's locked rate), and the two are only
 * comparable because they were read together.
 *
 * `blockNumber` / `asOf` / `ai3Shannons` are carried so a binding charge can be
 * reconciled later against the exact pool state it was derived from.
 */
export type ExecutableQuote = {
  // USDC base units (6 decimals) required to acquire the requested AI3,
  // inclusive of the pool's swap fee.
  usdcAmount: bigint
  // Marginal AI3/USD price, scaled by USD_RATE_SCALE (1e18).
  usdPerAi3: bigint
  // The slippage this trade's own size incurs, EXCLUDING the swap fee that any
  // trade pays. Already reflected in `usdcAmount`; reported so callers can
  // display it, alert on it, and reconcile against it. Not a rejection signal —
  // negative values are clamped to zero.
  priceImpactBps: bigint
  // Total premium of the executable cost over the marginal cost, fee included —
  // the honest "what this costs above spot" figure for display and telemetry.
  quotePremiumBps: bigint
  // The amount that was quoted, echoed back so callers cannot mismatch it.
  ai3Shannons: bigint
  // Block every field above was read at.
  blockNumber: bigint
  asOf: Date
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
 * The pool has no liquidity to fill the requested size — the quoter reverts
 * rather than returning a partial fill.
 *
 * Expensive is NOT the same as too large. A size that converts at heavy
 * slippage still gets a quote, with the slippage priced into `usdcAmount`;
 * whether such a size is permitted is settled upstream against the per-user
 * credit cap, before an intent exists. So this error never reflects a policy
 * threshold, only the pool's actual inability to fill.
 *
 * Reserved strictly for "reduce the amount" — a caller may safely surface it as
 * that instruction. Amounts that are invalid for any other reason raise
 * `InvalidQuoteAmountError`, and failures to reach the chain raise
 * `OracleUnavailableError`.
 */
export class QuoteTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuoteTooLargeError'
  }
}

/**
 * The requested amount cannot be quoted on its own terms — non-positive, beyond
 * the exact-output width the pool accepts, or so small it prices below a single
 * USDC base unit.
 *
 * Deliberately distinct from `QuoteTooLargeError`: telling a user who asked for
 * too little to reduce their purchase is worse than not answering at all.
 */
export class InvalidQuoteAmountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidQuoteAmountError'
  }
}

/**
 * The pool's current price is too far from its recent median to be trusted.
 *
 * The pool has no oracle hook, so every read is single-block spot state that a
 * trade immediately beforehand can move. This is the gate against quoting off a
 * manipulated price; it is a refusal to answer, not a statement about the
 * requested amount.
 */
export class PriceDeviationError extends Error {
  constructor(
    message: string,
    readonly deviationBps: bigint,
  ) {
    super(message)
    this.name = 'PriceDeviationError'
  }
}
