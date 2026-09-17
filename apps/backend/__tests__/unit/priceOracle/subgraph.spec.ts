import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import {
  fetchRecentSwapsFrom,
  resolveEndpoint,
  RECENT_SWAPS_QUERY,
  SubgraphConfigError,
} from '../../../src/infrastructure/services/priceOracle/subgraph.js'
import {
  POOL_ID,
  USDC_ADDRESS,
  WAI3_ADDRESS,
} from '../../../src/infrastructure/services/priceOracle/pool.js'

// Shapes taken from a real gateway response (verified 2026-08-10): amounts are
// BigDecimal strings in WHOLE TOKENS and signed by direction, `_meta.block
// .timestamp` is nullable in graph-node's schema, and the pool's tokens come
// back lowercased.
const meta = (overrides: Record<string, unknown> = {}) => ({
  block: { number: 25_725_462, timestamp: 1_786_375_343 },
  hasIndexingErrors: false,
  ...overrides,
})

// `totalValueLockedToken1` is the pool's USDC balance; 2898.005731 is what it
// actually held on 2026-08-11, five days after being drained to zero.
const pool = (overrides: Record<string, unknown> = {}) => ({
  token0: { id: WAI3_ADDRESS.toLowerCase(), decimals: '18' },
  token1: { id: USDC_ADDRESS.toLowerCase(), decimals: '6' },
  totalValueLockedToken1: '2898.005731',
  ...overrides,
})

const swap = (amount0: string, amount1: string, timestamp = '1785917567') => ({
  id: `0xdeadbeef-${timestamp}-${amount0}`,
  timestamp,
  amount0,
  amount1,
})

// An explicit endpoint, so nothing here depends on what happens to be in .env.
const ENDPOINT = { url: 'https://subgraph.test/query', apiKey: 'test-key' }

const SINCE_MS = 1_785_800_000_000

const fetchSwaps = (maxSamples: number, sinceMs = SINCE_MS) =>
  fetchRecentSwapsFrom(ENDPOINT, { sinceMs, maxSamples })

const respondWith = (
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
) =>
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)

describe('priceOracle/subgraph', () => {
  beforeEach(() => {
    // Any test that forgets to stub the response must fail loudly rather than
    // reach the real gateway. Without this the suite silently queries the live
    // subgraph — which is how a passing test can depend on whether a pool
    // traded this week, and on a metered API key.
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      throw new Error(`unstubbed network call to ${String(input)}`)
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('mapping', () => {
    it('scales whole-token BigDecimals into absolute base units', () => {
      // 199392.024 WAI3 in for 477.1285 USDC out, as the pool actually filled it
      // — this pool's most recent fill, and a sell.
      const fetchMock = respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [swap('199392.024', '-477.1285')],
        },
      })

      return fetchSwaps(10).then((result) => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(result.samples).toEqual([
          {
            ai3Amount: 199_392_024_000_000_000_000_000n,
            usdcAmount: 477_128_500n,
            direction: 'sell',
            timestampMs: 1_785_917_567_000,
          },
        ])
      })
    })

    it('reads direction off the USDC leg and keeps the legs absolute', async () => {
      // Amounts are the POOL's deltas: USDC entering it (positive amount1) means
      // the trader paid USDC and took AI3 away. Two fills identical but for
      // direction price the same — the ratio of the legs is the price either
      // way — while the direction itself is recorded once instead of being
      // implied twice by two signs that always disagree.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [swap('-1000.5', '6.4032'), swap('1000.5', '-6.4032')],
        },
      })

      const { samples } = await fetchSwaps(10)

      expect(samples).toHaveLength(2)
      expect(samples[0].direction).toBe('buy')
      expect(samples[1].direction).toBe('sell')
      expect(samples[0].usdcAmount).toBe(samples[1].usdcAmount)
      expect(samples[0].ai3Amount).toBe(samples[1].ai3Amount)
    })

    it('drops a row whose legs agree in sign, which is not a swap', async () => {
      // Both legs entering or both leaving is not a trade. None of this pool's
      // 236 fills has ever looked like that, so it is dropped on the same footing
      // as any other unreadable row rather than being given a direction.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [swap('1000.5', '6.4032'), swap('1000.5', '-6.4032')],
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      expect(samples).toHaveLength(1)
      expect(samples[0].direction).toBe('sell')
      expect(unparsedSwaps).toBe(1)
    })

    it('truncates fractional dust below one base unit rather than failing', async () => {
      // BigDecimal can carry more precision than USDC can represent.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [swap('1.0', '-0.0000004')],
        },
      })

      const { samples } = await fetchSwaps(10)

      // 0.4 base units truncates to 0, which makes the leg unusable and the
      // sample is dropped rather than priced at zero.
      expect(samples).toHaveLength(0)
    })

    it('drops a swap with a zero leg instead of rejecting the response', async () => {
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [swap('0', '-5.0'), swap('1000.5', '-6.4032')],
        },
      })

      const { samples } = await fetchSwaps(10)

      expect(samples).toHaveLength(1)
    })

    it('drops an amount it cannot parse instead of failing the window', async () => {
      // Exponent notation is the realistic case: the parser rejects it (it also
      // parses the configured price bounds, where mis-scaling silently would be
      // worse), and graph-node renders BigDecimal through Rust's `Display`,
      // which uses exponent form for scales far from zero. One such row used to
      // fail the whole response — and be reported as a gateway outage.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            swap('1.5e-8', '-6.4032'),
            swap('1000.5', '-6.4032'),
            swap('1000.5', '-1E+3'),
          ],
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      expect(samples).toHaveLength(1)
      // Counted, so the format problem is visible rather than showing up as a
      // window that is inexplicably short.
      expect(unparsedSwaps).toBe(2)
    })

    it('reports nothing unparsed for a well-formed response', async () => {
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [swap('1000.5', '-6.4032'), swap('0', '-5.0')],
        },
      })

      // A zero leg is dropped, but it parsed — the two counts answer different
      // questions and only one of them means "the indexer changed format".
      expect((await fetchSwaps(10)).unparsedSwaps).toBe(0)
    })

    it('flags a full page, since the window may extend past it', async () => {
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [swap('1000.5', '-6.4032'), swap('1000.5', '-6.4032')],
        },
      })

      expect((await fetchSwaps(2)).truncated).toBe(true)
      expect((await fetchSwaps(3)).truncated).toBe(false)
    })

    it('judges truncation on rows returned, not on samples kept', async () => {
      // A full page can map to fewer samples — a zero leg here — and it is the
      // page being full that says fills may be missing, not what survived
      // mapping.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [swap('0', '-5.0'), swap('1000.5', '-6.4032')],
        },
      })

      const { samples, truncated } = await fetchSwaps(2)

      expect(samples).toHaveLength(1)
      expect(truncated).toBe(true)
    })

    it('reports the pool USDC balance as depth, in base units', async () => {
      respondWith({
        data: { _meta: meta(), pool: pool(), swaps: [] },
      })

      expect((await fetchSwaps(10)).poolUsdcDepth).toBe(2_898_005_731n)
    })

    it('reads a negative pool balance as no depth', async () => {
      // Subgraph TVL tracking is known to drift negative; that is an accounting
      // artifact rather than unreadable data, and the only honest reading of
      // negative depth is none — which the floor downstream then refuses.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool({ totalValueLockedToken1: '-0.000004' }),
          swaps: [],
        },
      })

      expect((await fetchSwaps(10)).poolUsdcDepth).toBe(0n)
    })

    it('refuses a pool balance it cannot read at all', async () => {
      // Unlike a swap row there is nothing to fall back on: a depth guard cannot
      // be judged without this figure.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool({ totalValueLockedToken1: 'not-a-number' }),
          swaps: [],
        },
      })

      await expect(fetchSwaps(10)).rejects.toThrow(/unreadable pool USDC/)
    })

    it('reports the indexer head and its error flag', async () => {
      respondWith({
        data: {
          _meta: meta({ hasIndexingErrors: true }),
          pool: pool(),
          swaps: [],
        },
      })

      const result = await fetchSwaps(10)

      expect(result.indexerBlock).toBe(25_725_462n)
      expect(result.indexerTimestampMs).toBe(1_786_375_343_000)
      expect(result.hasIndexingErrors).toBe(true)
    })
  })

  describe('identity', () => {
    // Every failure in this block is a deployment mistake rather than an
    // outage, and each is typed as such so index.ts can report `misconfigured`
    // instead of folding it into "we cannot reach The Graph" — the diagnosis
    // that sends an operator to a status page to debug a stale constant.
    it('rejects a pool whose currencies are the other way round', async () => {
      // The failure this exists for: every price would simply be inverted, and
      // nothing downstream could tell.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool({
            token0: { id: USDC_ADDRESS.toLowerCase(), decimals: '6' },
            token1: { id: WAI3_ADDRESS.toLowerCase(), decimals: '18' },
          }),
          swaps: [swap('1000.5', '-6.4032')],
        },
      })

      await expect(fetchSwaps(10)).rejects.toThrow(
        /ordered the other way round/,
      )
      await expect(fetchSwaps(10)).rejects.toBeInstanceOf(SubgraphConfigError)
    })

    it('rejects decimals that contradict the price scaling', async () => {
      respondWith({
        data: {
          _meta: meta(),
          pool: pool({
            token0: { id: WAI3_ADDRESS.toLowerCase(), decimals: '9' },
            token1: { id: USDC_ADDRESS.toLowerCase(), decimals: '6' },
          }),
          swaps: [],
        },
      })

      await expect(fetchSwaps(10)).rejects.toThrow(/decimals=9/)
    })

    it('rejects a subgraph that does not have the pool', async () => {
      respondWith({ data: { _meta: meta(), pool: null, swaps: [] } })

      await expect(fetchSwaps(10)).rejects.toThrow(
        new RegExp(`no pool ${POOL_ID}`),
      )
      await expect(fetchSwaps(10)).rejects.toBeInstanceOf(SubgraphConfigError)
    })

    it('does not type a transport failure as a configuration problem', async () => {
      // The distinction only earns its keep if it stays narrow: a 5xx is still
      // an outage, and must not be reported as "fix your deployment".
      respondWith({ message: 'bad gateway' }, { ok: false, status: 502 })

      await expect(fetchSwaps(10)).rejects.not.toBeInstanceOf(
        SubgraphConfigError,
      )
    })
  })

  describe('unusable responses', () => {
    it('surfaces an HTTP failure with its status', async () => {
      respondWith({ message: 'rate limited' }, { ok: false, status: 429 })

      await expect(fetchSwaps(10)).rejects.toThrow(/HTTP 429/)
    })

    it('surfaces GraphQL errors when no data came with them', async () => {
      respondWith({ errors: [{ message: 'indexers failed' }] })

      await expect(fetchSwaps(10)).rejects.toThrow(/indexers failed/)
    })

    it('treats an indexing error riding alongside data as an indexing error', async () => {
      // graph-node's own tests pin this shape: "With `allow`, the error remains
      // but the data is included". Throwing on the errors array would report
      // every indexing failure as a gateway outage and make the `indexer-error`
      // reason unreachable from a real response.
      respondWith({
        data: {
          _meta: meta({ hasIndexingErrors: false }),
          pool: pool(),
          swaps: [swap('1000.5', '-6.4032')],
        },
        errors: [{ message: 'indexing_error' }],
      })

      const result = await fetchSwaps(10)

      expect(result.hasIndexingErrors).toBe(true)
      expect(result.samples).toHaveLength(1)
    })

    it('refuses a null block timestamp rather than reading it as zero', async () => {
      // `_Block_.timestamp` is nullable in graph-node's schema. Read as a
      // number it becomes 0, and the lag guard then reports the indexer as
      // fifty-odd years behind, forever.
      respondWith({
        data: {
          _meta: {
            block: { number: 25_725_462, timestamp: null },
            hasIndexingErrors: false,
          },
          pool: pool(),
          swaps: [],
        },
      })

      await expect(fetchSwaps(10)).rejects.toThrow(/no block timestamp/)
    })

    it('refuses a response with no swaps collection', async () => {
      respondWith({ data: { _meta: meta(), pool: pool() } })

      await expect(fetchSwaps(10)).rejects.toThrow(/no swaps collection/)
    })
  })

  describe('endpoint', () => {
    it('requires an API key when talking to the gateway', () => {
      expect(() => resolveEndpoint(undefined, undefined)).toThrow(
        /GRAPH_API_KEY/,
      )
      // Typed, so a deployment missing its credential is reported as
      // `misconfigured` rather than as an unreachable gateway.
      expect(() => resolveEndpoint(undefined, undefined)).toThrow(
        SubgraphConfigError,
      )
    })

    it('allows an unauthenticated local mirror via the URL override', () => {
      const local = 'http://localhost:8000/subgraphs/name/uniswap-v4'

      expect(resolveEndpoint(local, undefined)).toEqual({
        url: local,
        apiKey: undefined,
      })
    })

    it('never sends the gateway credential to an overridden host', () => {
      // The key authenticates against The Graph's gateway and nothing else, so
      // an override — a mirror, a test double, a tunnel — must not receive it.
      // Both variables set is the normal state of a machine that also talks to
      // the gateway, so this is the configuration, not a mistake.
      const local = 'http://localhost:8000/subgraphs/name/uniswap-v4'

      expect(resolveEndpoint(local, 'a-key').apiKey).toBeUndefined()
    })

    it('does not put the key in the request when there is none to send', async () => {
      const fetchMock = respondWith({
        data: { _meta: meta(), pool: pool(), swaps: [] },
      })

      await fetchRecentSwapsFrom(
        { url: 'http://localhost:8000/x' },
        { sinceMs: SINCE_MS, maxSamples: 10 },
      )

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.headers).not.toHaveProperty('Authorization')
    })

    it('defaults to the pinned gateway subgraph when no override is given', () => {
      const { url, apiKey } = resolveEndpoint(undefined, 'a-key')

      expect(url).toContain('gateway.thegraph.com')
      expect(apiKey).toBe('a-key')
    })

    it('sends the pool id, the window start and the row cap as variables', async () => {
      const fetchMock = respondWith({
        data: { _meta: meta(), pool: pool(), swaps: [] },
      })

      await fetchSwaps(7, 1_785_800_000_500)

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(init.body as string)).toEqual({
        query: RECENT_SWAPS_QUERY,
        variables: {
          pool: POOL_ID,
          first: 7,
          // Seconds, as a string: graph-node's BigInt scalar is a string on the
          // wire, and swap timestamps are seconds.
          since: '1785800000',
        },
      })
    })

    it('asks for the depth field the liquidity floor judges', () => {
      // The pool object is already queried for token identity, and depth is on
      // it — so this costs no extra round trip. `totalValueLockedUSD` is on the
      // same object and deliberately not used: it is a valuation derived through
      // the subgraph's own pricing paths, the reason `amountUSD` is refused too.
      expect(RECENT_SWAPS_QUERY).toMatch(/totalValueLockedToken1/)
      expect(RECENT_SWAPS_QUERY).not.toMatch(/totalValueLockedUSD/)
    })

    it('selects the window by time, leaving the count as a cap', () => {
      // The distinction the whole guard rests on. `first` alone selects the
      // newest N and no age filter can reach past them for an older fill, so a
      // burst of trades evicts history rather than competing with it.
      expect(RECENT_SWAPS_QUERY).toMatch(
        /where: \{ pool: \$pool, timestamp_gt: \$since \}/,
      )
      // The schema's own types, read from the live gateway: `timestamp_gt` is
      // BigInt, and `Swap_filter.pool` is String — which is why an ID! variable
      // has always been accepted there.
      expect(RECENT_SWAPS_QUERY).toMatch(/\$since: BigInt!/)
    })

    it('asks for data alongside indexing errors rather than instead of it', () => {
      // graph-node defaults every root field to `subgraphError: deny`, which
      // fails the whole query when the deployment has an indexing error — so the
      // hasIndexingErrors flag would never be seen and the outage would be
      // misreported as a gateway failure.
      expect(RECENT_SWAPS_QUERY).toMatch(
        /pool\(id: \$pool, subgraphError: allow\)/,
      )
      expect(RECENT_SWAPS_QUERY).toMatch(/subgraphError: allow\s*\)\s*\{/)
    })
  })
})
