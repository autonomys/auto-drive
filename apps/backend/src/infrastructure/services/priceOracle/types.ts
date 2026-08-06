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
  // Block the price was read at. Required, not optional: it is what the
  // manipulation gate anchors its window to, and a source that cannot say which
  // block it read cannot be gated.
  blockNumber: bigint
  // In-range liquidity at that block. Zero means the marginal price is not a
  // price anyone can trade at — see `PoolObservation.liquidity`.
  liquidity: bigint
  // Epoch milliseconds the source last updated the quote, when exposed by the
  // API; used to drop stale quotes. Undefined when not reported.
  asOfMs?: number
}

/**
 * One price observation at a block, as fed to `timeWeightedAverage`.
 *
 * Produced from `Swap` events (each carries the price the swap left behind) and
 * from the single state read that seeds the window.
 */
export type PricePoint = {
  blockNumber: bigint
  // AI3/USD price scaled by USD_RATE_SCALE (1e18).
  usdPerAi3: bigint
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
  //
  // A FLOOR on the conversion cost, not an estimate of it. Slippage is convex,
  // and every intent is priced against instantaneous pool state as though it
  // were the only one — so an operator converting a batch pays the cost of the
  // COMBINED size, which is strictly above the sum of the individual
  // `usdcAmount`s. Ten intents each taking 1/40th of the reserve quote at ~2.6%
  // apiece while acquiring the combined 25% costs ~33%. Reconcile actual batch
  // cost against the sum of these, and size USD_QUOTE_MARGIN for the expected
  // batch rather than for a single purchase.
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
 * The pool holds no in-range liquidity at all, so nothing can be quoted against
 * it at any size.
 *
 * Distinct from `QuoteTooLargeError` because the quoter cannot tell them apart:
 * it reverts with the same `NotEnoughLiquidity` whether the pool is merely too
 * shallow for this trade or has been emptied entirely. Only the liquidity read
 * separates them, and the difference matters — "reduce the amount" is advice a
 * user can act on, and on an empty pool it is advice that cannot possibly work.
 *
 * Not part of `ExecutableQuoteError`: callers see it as an oracle outage, which
 * is what it is.
 */
export class PoolEmptyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PoolEmptyError'
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
 * The pool's current price is too far from its trailing average to be trusted.
 *
 * The pool has no oracle hook, so every read is single-block spot state that a
 * trade immediately beforehand can move. This is the gate against quoting off a
 * manipulated price; it is a refusal to answer, not a statement about the
 * requested amount.
 *
 * `deviationBps` is signed: negative when spot sits BELOW the average (the
 * direction that under-collects, and the only profitable one to attack) and
 * positive when it sits above. `referenceUsdPerAi3` is the average it was
 * judged against, carried so an alert can show both numbers.
 */
export class PriceDeviationError extends Error {
  constructor(
    message: string,
    readonly deviationBps: bigint,
    readonly referenceUsdPerAi3: bigint,
  ) {
    super(message)
    this.name = 'PriceDeviationError'
  }
}
