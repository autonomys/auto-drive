/**
 * Reads the pool's recent trade history from its subgraph on The Graph.
 *
 * I/O and mapping only: this module turns a GraphQL response into
 * `SwapSample`s and says nothing about whether the window is usable. Every
 * judgement — how old is too old, how thin is too thin — belongs to index.ts,
 * so there is exactly one place where a refusal can originate.
 *
 * The window's lower time bound is still index.ts's decision; it is merely
 * APPLIED here, in the `where` clause, because a page limited by count cannot be
 * turned back into a time window after the fact. Filtering a fixed number of
 * newest fills can only shrink that number, never reach past it for an older
 * one — so selecting by count and filtering by time afterwards let a burst of
 * fills EVICT the market's history instead of competing with it.
 *
 * The one exception is identity. A response describing the WRONG pool is not a
 * market condition to be judged, it is a misconfiguration, and it is checked
 * here because this is where the answer arrives: the tokens are verified
 * against POOL_KEY's ordering before any amount is mapped. Silently accepting
 * a pool with the currencies the other way round would invert every price the
 * oracle produces, which no downstream guard could detect — the numbers would
 * simply be wrong, and plausibly so.
 */

import { config } from '../../../config.js'
import { AI3_DECIMALS, USDC_DECIMALS } from '../../../shared/utils/index.js'
import {
  POOL_ID,
  USDC_ADDRESS,
  WAI3_ADDRESS,
  defaultSubgraphUrl,
} from './pool.js'
import { parseDecimalToScaledBigint } from './quote.js'
import type { SwapSample } from './types.js'

/**
 * The deployment is wrong, as opposed to the source being down.
 *
 * Thrown for the failures a redeploy fixes and waiting does not: no credential
 * to query with, or a subgraph that does not describe the pool `pool.ts` pins.
 * It exists so index.ts can report those as `misconfigured` rather than folding
 * them into `gateway` — "we cannot reach The Graph" and "we are pointed at the
 * wrong pool" send an operator to two different places, and the taxonomy is
 * there precisely so a dashboard need not guess which one it is.
 */
export class SubgraphConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubgraphConfigError'
  }
}

/**
 * Which fills to ask for: everything the pool traded since `sinceMs`, up to
 * `maxSamples` rows.
 *
 * The time bound SELECTS the window and the count only caps the response, and
 * that order is the whole point. The other way round — newest N, then filter by
 * age — makes the window a count window whatever the age bound says, because
 * filtering can only shrink N. An attacker printing a bare majority of N fills
 * then owns the median outright, at a cost that does not depend on how much the
 * market traded: six fills buy six of ten slots whether the pool filled eleven
 * times this week or eleven thousand.
 */
export type SwapWindowQuery = {
  // Exclusive lower bound on a fill's timestamp.
  sinceMs: number
  // Cap on rows returned, sized so a real market never reaches it.
  maxSamples: number
}

export type SwapWindowResponse = {
  // Newest first, as returned; samples with a zero leg are already dropped.
  samples: SwapSample[]
  indexerBlock: bigint
  indexerTimestampMs: number
  // The page came back full, so there may be fills inside the window we never
  // saw and this is a count window again — the very thing selecting by time
  // exists to avoid. Reported rather than accepted: index.ts refuses, because a
  // window we cannot bound is one whose median we cannot vouch for.
  truncated: boolean
  // USDC the pool currently holds, in base units. Depth, as opposed to volume:
  // volume is what traded and can be churned, depth is what is sitting there.
  poolUsdcDepth: bigint
  // Rows dropped because an amount did not parse. Counted rather than swallowed:
  // the window is still usable, but a number above zero means the indexer is
  // emitting a format this oracle does not read, and that should be visible in a
  // log instead of inferred from a sample count that came back low.
  unparsedSwaps: number
  // The subgraph's own report that it failed to index something. Surfaced
  // rather than acted on here — index.ts owns what to do about it.
  hasIndexingErrors: boolean
}

/**
 * One round trip for everything a window needs: the indexer's head (is the
 * source current?), the pool's identity (are we reading what we think?), and
 * the swaps themselves.
 *
 * `timestamp_gt` is what makes this a time window rather than a count window:
 * the server selects every fill inside the period and `first` only bounds the
 * response. Both variable types are the schema's own, checked against the live
 * gateway rather than assumed — `Swap_filter.timestamp_gt` is `BigInt`, and
 * `Swap_filter.pool` is `String`, which is why an `ID!` variable has always been
 * accepted there.
 *
 * Amounts come back as BigDecimal strings in whole tokens — "199392.024", not
 * base units — and signed by direction, since one leg enters the pool while the
 * other leaves. `amountUSD` is deliberately not requested: it is the subgraph's
 * own valuation derived through its pricing paths, whereas amount1 IS the USDC
 * that changed hands. A realized fill is the whole point.
 *
 * `totalValueLockedToken1` is the pool's USDC balance, and it is asked for on the
 * same grounds `amountUSD` is refused: it is a token quantity the pool holds
 * rather than a valuation derived through anything. `totalValueLockedUSD` exists
 * on this entity and is deliberately NOT used for that reason, and `liquidity`
 * is not used because it is an in-range v4 L, a unit no operator can write a
 * floor in. Field names read off the live schema by introspection.
 */
export const RECENT_SWAPS_QUERY = `
  query RecentSwaps($pool: ID!, $first: Int!, $since: BigInt!) {
    _meta {
      block {
        number
        timestamp
      }
      hasIndexingErrors
    }
    pool(id: $pool, subgraphError: allow) {
      token0 {
        id
        decimals
      }
      token1 {
        id
        decimals
      }
      totalValueLockedToken1
    }
    swaps(
      first: $first
      orderBy: timestamp
      orderDirection: desc
      where: { pool: $pool, timestamp_gt: $since }
      subgraphError: allow
    ) {
      id
      timestamp
      amount0
      amount1
    }
  }
`

type GraphSwap = {
  id: string
  timestamp: string
  amount0: string
  amount1: string
}

type GraphResponse = {
  data?: {
    _meta: {
      // `timestamp` is NULLABLE in graph-node's schema (`_Block_`), so it is
      // typed as such here and validated below rather than trusted: read as a
      // number it would silently become 0, and every read would then refuse
      // with "the indexer is 1.7 billion seconds behind".
      block: { number: number; timestamp: number | null }
      hasIndexingErrors: boolean
    } | null
    pool: {
      token0: { id: string; decimals: string }
      token1: { id: string; decimals: string }
      totalValueLockedToken1: string
    } | null
    swaps: GraphSwap[]
  }
  errors?: { message: string }[]
}

// A BigDecimal amount in whole tokens, signed by direction, as a base-unit
// magnitude plus that sign.
//
// The two legs of a swap always carry OPPOSITE signs — verified across all 236
// fills this pool has recorded — so the direction is one fact, and the price math
// wants magnitudes. Reading it off one leg and dropping it from both is what lets
// `direction` be stated once rather than implied twice.
//
// `null` for anything the parser does not accept, which for this input means
// exponent notation. The parser is deliberately strict — it also parses the
// configured price bounds, where silently mis-scaling a value would be far
// worse — so the tolerance belongs here, at the row, rather than in it.
//
// Nothing in this pool's 236 recorded fills is anything but a plain decimal
// (checked against the gateway 2026-08-11, at most 18 fractional digits), but
// graph-node's BigDecimal is a Rust `bigdecimal` rendered through `Display`,
// which switches to exponent form for scales far from zero, so it is not ruled
// out either. Dropping the row costs nothing real: the only amounts extreme
// enough to reach that form are dust that truncates to zero base units anyway —
// already dropped below — or magnitudes neither token can represent.
type SignedAmount = { magnitude: bigint; negative: boolean }

const toBaseUnits = (
  amount: string,
  decimals: number,
): SignedAmount | null => {
  const trimmed = amount.trim()
  try {
    return {
      magnitude: parseDecimalToScaledBigint(
        trimmed.replace(/^-/, ''),
        decimals,
      ),
      negative: trimmed.startsWith('-'),
    }
  } catch {
    return null
  }
}

/**
 * Where to send the query, and with what credential.
 *
 * Takes its inputs as arguments rather than reading `config` directly so it can
 * be exercised without one: `config` snapshots the environment at import, so a
 * test that mutates `process.env` changes nothing — a trap worth designing out
 * rather than remembering.
 *
 * The key authenticates against The Graph's gateway and nothing else, so it is
 * required only when we are actually talking to the gateway, and it TRAVELS only
 * there. An override names some other host — a local mirror, a test double, a
 * tunnel — and attaching a billed credential to a request bound for it would
 * hand the secret to whatever that variable happens to point at. So the key
 * rides with the pinned gateway URL or not at all, which is also what makes the
 * override safe to point anywhere.
 */
export type SubgraphEndpoint = { url: string; apiKey?: string }

export const resolveEndpoint = (
  override: string | undefined,
  apiKey: string | undefined,
): SubgraphEndpoint => {
  if (override) {
    return { url: override }
  }
  if (!apiKey) {
    throw new SubgraphConfigError(
      'GRAPH_API_KEY is not set — the AI3/USD oracle cannot query the pool ' +
        'subgraph through the gateway, so USDC payments cannot be quoted ' +
        '(set GRAPH_SUBGRAPH_URL instead to point at an unauthenticated mirror)',
    )
  }
  return { url: defaultSubgraphUrl(), apiKey }
}

const assertPoolIdentity = (
  pool: NonNullable<NonNullable<GraphResponse['data']>['pool']>,
): void => {
  const expected = [
    { side: 'token0', address: WAI3_ADDRESS, decimals: AI3_DECIMALS },
    { side: 'token1', address: USDC_ADDRESS, decimals: USDC_DECIMALS },
  ] as const
  const actual = [pool.token0, pool.token1]

  expected.forEach(({ side, address, decimals }, index) => {
    const token = actual[index]
    if (token.id.toLowerCase() !== address.toLowerCase()) {
      throw new SubgraphConfigError(
        `Subgraph pool ${POOL_ID} has ${side}=${token.id}, expected ` +
          `${address} — this is a different pool, or its currencies are ` +
          'ordered the other way round, either of which inverts every price',
      )
    }
    if (Number(token.decimals) !== decimals) {
      throw new SubgraphConfigError(
        `Subgraph pool ${POOL_ID} reports ${side} decimals=${token.decimals}, ` +
          `expected ${decimals} — the price scaling assumes otherwise`,
      )
    }
  })
}

/**
 * Fetch every swap the pool has filled since `sinceMs`, up to `maxSamples` rows.
 *
 * Throws on anything that makes the response unusable — transport failure,
 * GraphQL errors, a missing or mismatched pool. A single unreadable row is not
 * that: it is dropped and counted. There is no partially usable RESPONSE, but
 * there is a usable window with a row missing from it.
 *
 * Takes the endpoint rather than resolving one, so that everything below can be
 * exercised without an environment. `config` snapshots env at import: a suite
 * that resolved its own endpoint would pass on a developer machine holding a
 * key in .env and fail in CI, which is precisely how this seam came to exist.
 */
export const fetchRecentSwapsFrom = async (
  { url, apiKey }: SubgraphEndpoint,
  { sinceMs, maxSamples }: SwapWindowQuery,
  signal?: AbortSignal,
): Promise<SwapWindowResponse> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      query: RECENT_SWAPS_QUERY,
      variables: {
        pool: POOL_ID,
        first: maxSamples,
        // graph-node's BigInt scalar is a string on the wire, and swap
        // timestamps are seconds.
        since: String(Math.floor(sinceMs / 1000)),
      },
    }),
    signal,
  })

  if (!response.ok) {
    // The body may carry the reason (rate limit, exhausted budget); the key is
    // never in it, and must never be logged from here either.
    const detail = await response.text().catch(() => '')
    throw new Error(
      `Subgraph query failed: HTTP ${response.status} ${detail.slice(0, 200)}`,
    )
  }

  const body = (await response.json()) as GraphResponse
  const errors = body.errors ?? []

  // Errors are NOT automatically fatal, and the order here is the whole point.
  //
  // Under `subgraphError: allow`, graph-node returns the data it has AND an
  // entry in `errors` — its own test suite pins this: "With `allow`, the error
  // remains but the data is included", against `{"message": "indexing_error"}`.
  // Throwing on any `errors` would therefore report every indexing failure as a
  // gateway outage and make the `indexer-error` reason unreachable, which is
  // exactly the diagnosis an operator needs to tell "The Graph is broken" from
  // "we cannot reach The Graph".
  //
  // So the presence of usable data decides. No data means the query itself
  // failed — a validation error, a timeout, indexers giving up — and that is an
  // outage. Data present means the errors accompanying it are the indexing kind,
  // and the window is refused downstream with the reason that names them.
  if (!body.data?._meta) {
    throw new Error(
      errors.length
        ? `Subgraph query returned errors: ${errors
            .map((e) => e.message)
            .join('; ')
            .slice(0, 300)}`
        : 'Subgraph query returned no indexing metadata',
    )
  }
  const indexerTimestamp = body.data._meta.block.timestamp
  if (typeof indexerTimestamp !== 'number') {
    throw new Error(
      'Subgraph reported no block timestamp, so how far behind it is cannot ' +
        'be judged',
    )
  }
  if (!body.data.pool) {
    throw new SubgraphConfigError(
      `Subgraph has no pool ${POOL_ID} — wrong subgraph, or the pool identity ` +
        'in pool.ts is stale',
    )
  }
  if (!Array.isArray(body.data.swaps)) {
    throw new Error('Subgraph query returned no swaps collection')
  }
  assertPoolIdentity(body.data.pool)

  // A row that cannot be used is dropped, never fatal — the same judgement for
  // an amount that does not parse as for a zero leg, which is the inconsistency
  // this once had: a zero leg was dropped per row while an unparseable one
  // failed the entire response, and failed it as a network outage. One bad row
  // is not an unreachable gateway, and the sample-count floor downstream already
  // decides whether what survives is enough to price from. Fewer rows can only
  // make the oracle refuse, never mislead it.
  let unparsedSwaps = 0
  const samples: SwapSample[] = body.data.swaps.flatMap((swap) => {
    const ai3 = toBaseUnits(swap.amount0, AI3_DECIMALS)
    const usdc = toBaseUnits(swap.amount1, USDC_DECIMALS)
    if (ai3 === null || usdc === null) {
      unparsedSwaps += 1
      return []
    }
    if (ai3.magnitude <= 0n || usdc.magnitude <= 0n) {
      return []
    }
    // Amounts are the POOL's deltas, so a positive USDC leg is USDC entering the
    // pool: the trader paid USDC and took AI3 away. Read off the USDC leg
    // because that is the side the oracle is denominated in, and cross-checked
    // against the other: legs that agree in sign are not a swap, and none of
    // this pool's 236 fills has ever done so. Dropped rather than trusted, on the
    // same footing as any other unreadable row.
    if (ai3.negative === usdc.negative) {
      unparsedSwaps += 1
      return []
    }
    return [
      {
        ai3Amount: ai3.magnitude,
        usdcAmount: usdc.magnitude,
        direction: usdc.negative ? ('sell' as const) : ('buy' as const),
        timestampMs: Number(swap.timestamp) * 1000,
      },
    ]
  })

  // The pool's own USDC balance. Unlike a swap row there is nothing to fall back
  // on if it will not parse — a depth guard cannot be judged without it — so this
  // one IS fatal, and `gateway` is the honest reason: the source returned JSON we
  // cannot read. A NEGATIVE balance is a known accounting artifact of subgraph
  // TVL tracking rather than unreadable data, and the only honest reading of
  // negative depth is none, which the floor downstream will refuse.
  const tvlToken1 = toBaseUnits(
    body.data.pool.totalValueLockedToken1,
    USDC_DECIMALS,
  )
  if (tvlToken1 === null) {
    throw new Error(
      'Subgraph reported an unreadable pool USDC balance ' +
        `("${body.data.pool.totalValueLockedToken1}"), so the pool's depth ` +
        'cannot be judged',
    )
  }

  return {
    samples,
    unparsedSwaps,
    poolUsdcDepth: tvlToken1.negative ? 0n : tvlToken1.magnitude,
    // Counted on ROWS RETURNED, not on samples kept: a page can be full and
    // still map to fewer samples, and it is the page being full that says the
    // window may have been cut short.
    truncated: body.data.swaps.length >= maxSamples,
    indexerBlock: BigInt(body.data._meta.block.number),
    indexerTimestampMs: indexerTimestamp * 1000,
    // Either signal counts. `hasIndexingErrors` is the deployment's own record
    // of past failures, while an error riding alongside the data is this
    // response saying it is incomplete right now — and a response that had to
    // be served under `allow` is not one to price a charge from either way.
    hasIndexingErrors: body.data._meta.hasIndexingErrors || errors.length > 0,
  }
}

// The one line that reads configuration, kept thin so everything it wraps stays
// testable without one.
export const fetchRecentSwaps = (
  query: SwapWindowQuery,
  signal?: AbortSignal,
): Promise<SwapWindowResponse> =>
  fetchRecentSwapsFrom(
    resolveEndpoint(
      config.priceOracle.subgraphUrl,
      config.priceOracle.graphApiKey,
    ),
    query,
    signal,
  )
