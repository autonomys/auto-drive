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
  // When the pool last filled among the swaps this rate averages — a fact about
  // the MARKET, where `asOf` is a fact about US.
  //
  // Carried rather than derived because the two can be far apart and only one
  // of them answers "is this number still describing anything". The strict
  // profile keeps them close by refusing a window whose newest fill is older
  // than ORACLE_MAX_SWAP_AGE_MS; the display profile drops that bound on
  // purpose, so there a rate built from a single month-old fill is served with
  // a fresh `asOf` and `stale: false`. Without this field no caller can tell
  // that apart from a rate struck a minute ago.
  newestSwapMs: number
  // True only for a fresh in-memory TTL cache hit; always false for a stale
  // last-good fallback (see `stale`) and for a freshly fetched value.
  fromCache: boolean
  // Served from the last-good fallback because the latest fetch failed (still
  // within maxStaleMs).
  stale: boolean
}

/**
 * Which way a fill went, from the trader's side: `buy` paid USDC for AI3, `sell`
 * the reverse.
 *
 * Kept rather than discarded because it is not the same fact as the amounts. The
 * pool takes its fee from whichever leg is the INPUT, so a buy's realized price
 * lands above mid and a sell's below, separated by roughly twice the swap fee —
 * about 2.2% on this pool's composed 1.099%. Nothing corrects for it: it sits
 * inside USD_QUOTE_MARGIN, and correcting it properly needs the composed fee
 * hardcoded, which is the assumption reading realized fills exists to avoid.
 *
 * What it does buy is the ability to check the assumption that it averages out.
 * A window's balance is not recoverable after the fact, and this pool's history
 * says the question is live: 153 of its 236 fills are sells, and sell-heavy is
 * the under-collecting direction. That needs no attacker, only a seller.
 */
export type SwapDirection = 'buy' | 'sell'

/**
 * One realized swap, normalized out of the indexer's representation.
 *
 * Both legs are absolute base-unit amounts and the direction is carried
 * alongside them: which leg entered the pool is one fact, stated once, rather
 * than a sign duplicated across two amounts that always disagree. What matters
 * is that the two legs belong to the same fill, because their ratio is a price
 * the pool actually honoured — fee and price impact included, unlike a quoted
 * one.
 */
export type SwapSample = {
  // USDC base units (6 decimals), absolute.
  usdcAmount: bigint
  // AI3 base units (shannons, 18 decimals), absolute.
  ai3Amount: bigint
  direction: SwapDirection
  timestampMs: number
}

/**
 * The window a rate was derived from.
 *
 * Carried rather than discarded because every consumer needs to describe it:
 * the guards judge it, the admin dashboard shows why the path is open or shut,
 * and the treasury report cannot suggest a conversion size without knowing how
 * thin the market behind the number is.
 */
export type SwapWindow = {
  // Volume-weighted AI3/USD price, scaled by USD_RATE_SCALE (1e18).
  usdPerAi3: bigint
  // Swaps that survived the outlier trim and produced the price above.
  sampleCount: number
  // Swaps dropped by the trim, kept separate so a window that is mostly
  // outliers is visible rather than merely small.
  droppedOutliers: number
  // How the surviving fills split by direction. Reported, not judged: the pool's
  // fee makes a buy print above mid and a sell below, so a lopsided window is
  // biased in a known direction and a dashboard should be able to say so. It is
  // also the only way to find out whether the "flow balances out" assumption
  // holds, since a window's balance cannot be recovered after the fact.
  buyCount: number
  sellCount: number
  // Total USDC base units traded across the surviving samples — the weight
  // behind the average, and what an operator means by "how much traded".
  volumeUsdc: bigint
  // The larger side's share of that, which is what the volume floor judges: a
  // round trip inflates the total while committing capital once.
  oneSidedVolumeUsdc: bigint
  // USDC the pool held when the window was read. Not part of the window, but the
  // fact that says whether it stands on anything — and the treasury report cannot
  // size a conversion without it.
  poolUsdcDepth: bigint
  // Span of the SURVIVING samples, not of everything fetched. Every field in
  // this struct describes the same set of fills, so an operator reading
  // "7 swaps over 4 days" is reading one consistent window rather than a count
  // from after the trim against a span from before it.
  newestSwapMs: number
  oldestSwapMs: number
  // Indexer head at query time. The window can be perfectly healthy while the
  // indexer that reported it has stopped, and those need different responses.
  indexerBlock: bigint
  indexerTimestampMs: number
}

/**
 * Why the oracle refused, in a form something other than a human can read.
 *
 * The message names the guard too, but a dashboard that has to regex a string
 * to render a status is a dashboard that breaks on the next wording change.
 */
export type OracleUnavailableReason =
  // The gateway could not be reached, errored, or returned unusable JSON.
  | 'gateway'
  // The deployment itself is wrong, not the market: no credential to query
  // with, or a subgraph that does not describe the pool we pinned. Separated
  // from `gateway` because waiting fixes one and only a redeploy fixes the
  // other, and an operator paged for an outage should not spend the incident
  // looking at The Graph's status page.
  | 'misconfigured'
  // Too few usable swaps in the window (before or after the outlier trim).
  | 'insufficient-samples'
  // The opposite problem: the window held more fills than one query may return,
  // so what came back is the newest N of it — a count window, which is what
  // selecting by time exists to avoid. Raising ORACLE_MAX_WINDOW_SAMPLES is the
  // fix; refusing meanwhile is the only honest answer, since a median over an
  // unbounded window is one we cannot vouch for.
  | 'window-truncated'
  // The most recent swap is older than the freshness bound — the market has
  // stopped, whatever the indexer says.
  | 'stale-window'
  // The market has re-priced past the window: the newest fill is itself an
  // outlier against the median of the rest, so the average describes a regime
  // the market has already left. Refusing is deliberate — the alternative is
  // charging at the OLD price, because a count-based median discards the very
  // fills that carry the new one.
  | 'market-moved'
  // The surviving fills are packed into too short an interval to be a market.
  // A handful of swaps in one block is something anyone can print on demand;
  // a price held across hours is not.
  | 'narrow-window'
  // The window traded too little for its average to mean anything, measured on
  // its larger side so a round trip cannot count twice.
  | 'thin-volume'
  // The pool itself holds too little to be priced from, whatever its fills say.
  // Distinct from `thin-volume` because volume can be churned in a circle for the
  // fee while depth has to be deposited and left there — one is what traded, the
  // other is what is standing behind it.
  | 'thin-liquidity'
  // The derived price sits outside the configured sanity bounds.
  | 'out-of-bounds'
  // The indexer itself is behind; the window describes a past we cannot date.
  | 'indexer-lag'
  // The indexer is current but reports that it failed to index something, so
  // what it served may be incomplete in ways we cannot see from here.
  | 'indexer-error'
  // The ORACLE failed, not the market and not the source: an invariant its own
  // statistics assert was violated. The only reason here whose answer is a stack
  // trace rather than a wait or a redeploy, which is exactly why it is not
  // folded into `gateway` — that sends whoever is paged to The Graph's status
  // page to debug our bug.
  | 'internal'

/**
 * A snapshot of what the oracle currently knows, for the admin dashboard and
 * the treasury report.
 *
 * `window` is the one behind the last SUCCESSFUL read, so it survives a
 * failure: "the rate we are serving came from 7 swaps over 4 days, and the last
 * refresh failed on indexer-lag" is two facts, and an operator needs both.
 */
export type OracleHealth = {
  lastSuccessAt: Date | null
  // The last failure, whenever it happened — history, retained after a
  // recovery, which is what #811's "which guard last fired" asks for. The two
  // fields are always set together, so a dashboard can never render a time
  // without the reason that went with it. Whether the oracle is failing RIGHT
  // NOW is `servingStale`, or the error `getPrice` returns.
  lastFailureAt: Date | null
  lastFailureReason: OracleUnavailableReason | null
  window: SwapWindow | null
  // Serving a last-good price because the live read is failing.
  servingStale: boolean
}

/**
 * Wrapped in a neverthrow `err` when no trustworthy rate is available — i.e.
 * USDC quoting cannot safely proceed right now.
 *
 * Every guard fails closed into this one error rather than degrading to a
 * best-effort number: the alternative to a refusal is charging someone at a
 * price nothing supports.
 */
export class OracleUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: OracleUnavailableReason,
  ) {
    super(message)
    this.name = 'OracleUnavailableError'
  }
}
