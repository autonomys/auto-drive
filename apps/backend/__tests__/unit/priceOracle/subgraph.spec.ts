import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import {
  ANCHOR_PAGE_SIZE,
  fetchRecentSwapsFrom,
  resolveEndpoint,
  RECENT_SWAPS_QUERY,
  SubgraphConfigError,
} from '../../../src/infrastructure/services/priceOracle/subgraph.js'
import {
  DEFAULT_SUBGRAPH_ID,
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

// A row as the CURRENT default deployment reports one: both legs unsigned, with
// the post-swap tick and the fill's position in its block. Shapes and magnitudes
// taken from a real gateway response (verified 2026-09-21) — ticks around
// -344_000, which is ~0.0011 USDC per WAI3 at 1.0001^tick scaled for 18dp vs
// 6dp.
const unsignedSwap = (
  amount0: string,
  amount1: string,
  timestamp: string,
  tick: string,
  // Nullable because the schema makes it so: `logIndex: BigInt` against
  // `tick: BigInt!`, which is the whole of the ordering problem below.
  logIndex: string | null = '1',
) => ({
  // The tick is in the id so that rows sharing a block with no logIndex are
  // still distinct entities, as they would be on the wire.
  id: `0xfeedface-${timestamp}-${logIndex}-${tick}`,
  timestamp,
  logIndex,
  tick,
  amount0,
  amount1,
})

// A FULL anchor page, which is the only size at which what the page might be
// missing matters. Indexes are distinct, so nothing here is ambiguous in the
// logIndex sense — what varies between these cases is only whether the page
// stopped inside a block.
const anchorPage = (timestamps: string[], tick = '-344400') =>
  timestamps.map((timestamp, index) => ({
    id: `anchor-${index}`,
    timestamp,
    logIndex: String(index),
    tick,
  }))

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

    it('drops a row whose legs agree in sign and carries no tick', async () => {
      // Agreeing legs are either not a trade at all or an indexer reporting
      // magnitudes, and one row cannot tell those apart — so the direction falls
      // through to tick movement. With no tick to fall through TO, nothing
      // answers, and the row is dropped on the same footing as any other
      // unreadable one rather than being given a direction.
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

  // The convention the current default deployment uses: both legs are
  // magnitudes, so the sign that used to name the side is simply not there and
  // the direction has to come from the price the fill left behind.
  describe('unsigned amounts', () => {
    it('reads direction from the tick a fill left the pool at', async () => {
      // Two fills. In block order the ticks run -344400 (anchor) → -344300 →
      // -344500: the first window fill lifted the tick, so WAI3 got dearer in
      // USDC and someone paid USDC for AI3 — a buy — and the second dropped it,
      // which is the reverse. The `anchor` row is what gives the OLDEST window
      // fill something to be compared against.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            unsignedSwap('9676.16', '10.51', '1789941299', '-344500'),
            unsignedSwap('70787.25', '80.45', '1789755803', '-344300'),
          ],
          anchor: [
            {
              id: 'anchor',
              timestamp: '1789700000',
              logIndex: '4',
              tick: '-344400',
            },
          ],
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      // Returned newest first, as the query ordered them.
      expect(samples.map((s) => s.direction)).toEqual(['sell', 'buy'])
      expect(unparsedSwaps).toBe(0)
      // The legs are still read as magnitudes, unaffected by carrying no sign.
      expect(samples[0].usdcAmount).toBe(10_510_000n)
    })

    it('drops the oldest fill when nothing precedes it to compare against', async () => {
      // No anchor: the pool has no history before the window, or the indexer
      // returned none. The oldest row then has no predecessor and gets no
      // direction — dropped rather than signed by the move that came after it,
      // which would be backwards.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            unsignedSwap('9676.16', '10.51', '1789941299', '-344500'),
            unsignedSwap('70787.25', '80.45', '1789755803', '-344300'),
          ],
          anchor: [],
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      // Only the newest survives, signed by the move from the row before it —
      // which is inside the window, so it needed no anchor.
      expect(samples).toHaveLength(1)
      expect(samples[0].direction).toBe('sell')
      expect(unparsedSwaps).toBe(1)
    })

    it('orders fills sharing a timestamp by logIndex, not by arrival', async () => {
      // Three of this pool's real fills share one timestamp because they were
      // in one block. graph-node cannot sort on two fields, so getting this
      // wrong inverts every direction in the block — which is why the order is
      // imposed here rather than trusted from the response.
      //
      // By logIndex the ticks run -344400 (anchor) → -344300 → -344350 →
      // -344200, i.e. buy, sell, buy. Handed over deliberately shuffled.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            unsignedSwap('1000', '1.1', '1789941299', '-344350', '79'),
            unsignedSwap('1000', '1.1', '1789941299', '-344200', '83'),
            unsignedSwap('1000', '1.1', '1789941299', '-344300', '28'),
          ],
          anchor: [
            {
              id: 'anchor',
              timestamp: '1789700000',
              logIndex: '4',
              tick: '-344400',
            },
          ],
        },
      })

      const { samples } = await fetchSwaps(10)

      // Response order is logIndex 79, 83, 28 — the order the rows arrived in.
      // Chained in BLOCK order the ticks run -344400 → -344300 (28, up: buy) →
      // -344350 (79, down: sell) → -344200 (83, up: buy), so read back in
      // arrival order the directions are sell, buy, buy.
      //
      // Chaining in arrival order instead would give buy, buy, sell. That the
      // two differ is the whole point of the assertion.
      expect(samples.map((s) => s.direction)).toEqual(['sell', 'buy', 'buy'])
    })

    it('drops a fill too small to move the tick rather than guessing', async () => {
      // An unchanged tick is a fill that did not move the price at all. That is
      // no evidence either way, so it gets no direction — the same treatment as
      // any other row the oracle cannot read, and the sample floor downstream
      // decides whether what survives is enough.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [unsignedSwap('1000', '1.1', '1789941299', '-344400')],
          anchor: [
            {
              id: 'anchor',
              timestamp: '1789700000',
              logIndex: '4',
              tick: '-344400',
            },
          ],
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      expect(samples).toHaveLength(0)
      expect(unparsedSwaps).toBe(1)
    })

    it('still prefers the signs when the indexer does provide them', async () => {
      // A signed row states the side outright, and nothing about it should
      // depend on a tick being present or on its neighbours. The tick here
      // would say "buy" if it were consulted; the signs say sell.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            {
              ...unsignedSwap('1000.5', '-6.4032', '1789941299', '-344100'),
            },
          ],
          anchor: [
            {
              id: 'anchor',
              timestamp: '1789700000',
              logIndex: '4',
              tick: '-344400',
            },
          ],
        },
      })

      const { samples } = await fetchSwaps(10)

      expect(samples[0].direction).toBe('sell')
    })

    it('drops the oldest fill when the anchor page stopped inside a block', async () => {
      // A full anchor page whose rows all share one timestamp means the block
      // at the window's edge held more fills than the page could carry, so what
      // came back is an arbitrary subset of it: graph-node breaks a timestamp
      // tie by `id`, not by logIndex, so the block's LAST fill — the only valid
      // predecessor — may simply not be here. Sorting what did arrive cannot
      // recover it.
      //
      // Trusting the newest row present would sign the window's oldest fill
      // against a mid-block price, which is a wrong direction rather than a
      // missing one. So the anchor is dropped whole and that fill goes
      // undirected.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            unsignedSwap('9676.16', '10.51', '1789941299', '-344500'),
            unsignedSwap('70787.25', '80.45', '1789755803', '-344300'),
          ],
          anchor: anchorPage(Array(ANCHOR_PAGE_SIZE).fill('1789700000')),
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      // Without the check the oldest fill reads as a buy, -344400 → -344300.
      expect(samples).toHaveLength(1)
      expect(samples[0].direction).toBe('sell')
      expect(unparsedSwaps).toBe(1)
    })

    it('trusts a full anchor page that reaches past the boundary block', async () => {
      // Same page size, but it spans two timestamps — and descending order
      // finishes a timestamp before moving to an older one, so every fill of
      // the newest one is present. The predecessor is certain, and the oldest
      // window fill keeps its direction.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            unsignedSwap('9676.16', '10.51', '1789941299', '-344500'),
            unsignedSwap('70787.25', '80.45', '1789755803', '-344300'),
          ],
          anchor: anchorPage([
            '1789700000',
            ...Array(ANCHOR_PAGE_SIZE - 1).fill('1789600000'),
          ]),
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      expect(samples.map((s) => s.direction)).toEqual(['sell', 'buy'])
      expect(unparsedSwaps).toBe(0)
    })

    it('refuses to order a block whose fills report no logIndex', async () => {
      // `logIndex` is optional in the schema while `tick` is not, so an indexer
      // can leave the field out and still report a usable tick. Three fills in
      // one block with no index are not orderable: the comparator calls them
      // equal, a stable sort leaves them as they arrived, and they arrived
      // NEWEST FIRST — so the block would be walked backwards and all three
      // directions inverted.
      //
      // Ticks -344300 / -344350 / -344200 in arrival order. Read backwards they
      // would come out buy, sell, buy with total confidence.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            unsignedSwap('1000', '1.1', '1789950000', '-344100', '1'),
            unsignedSwap('1000', '1.1', '1789941299', '-344300', null),
            unsignedSwap('1000', '1.1', '1789941299', '-344350', null),
            unsignedSwap('1000', '1.1', '1789941299', '-344200', null),
            unsignedSwap('1000', '1.1', '1789800000', '-344380', '2'),
          ],
          anchor: [
            {
              id: 'anchor',
              timestamp: '1789700000',
              logIndex: '4',
              tick: '-344400',
            },
          ],
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      // Only the fill BEFORE the unorderable block survives, signed off the
      // anchor. The one after it goes too: which of the block's ticks it moved
      // from is exactly what cannot be established.
      expect(samples).toHaveLength(1)
      expect(samples[0].timestampMs).toBe(1_789_800_000_000)
      expect(samples[0].direction).toBe('buy')
      expect(unparsedSwaps).toBe(4)
    })

    it('still reads a lone fill whose logIndex is missing', async () => {
      // A missing index only costs anything when something shares the row's
      // timestamp. Alone in its block there is nothing to order it against, so
      // the tick comparison stands.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [unsignedSwap('1000', '1.1', '1789941299', '-344300', null)],
          anchor: [
            {
              id: 'anchor',
              timestamp: '1789700000',
              logIndex: '4',
              tick: '-344400',
            },
          ],
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      expect(samples.map((s) => s.direction)).toEqual(['buy'])
      expect(unparsedSwaps).toBe(0)
    })

    it('derives nothing at all from a response it cannot put in order', async () => {
      // A row whose timestamp will not parse cannot be placed, and the cost is
      // not its own direction — it is every direction. It sorts to the front
      // instead of wherever it belongs, so the fill that truly followed it gets
      // compared against whatever precedes it there and comes out confidently
      // wrong. Condemning its block is no remedy: with no timestamp it is in no
      // block.
      //
      // Read in arrival order the ticks look like a clean chain. In the sorted
      // order the broken row leaves behind, the newest fill reads 'sell' off the
      // OLDEST one.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            unsignedSwap('1000', '1.1', '1789950000', '-344500'),
            unsignedSwap('1000', '1.1', 'not-an-integer', '-344600'),
            unsignedSwap('1000', '1.1', '1789800000', '-344300'),
          ],
          anchor: [
            {
              id: 'anchor',
              timestamp: '1789700000',
              logIndex: '4',
              tick: '-344400',
            },
          ],
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      expect(samples).toHaveLength(0)
      expect(unparsedSwaps).toBe(3)
    })

    it('discards a short anchor page holding a fill it cannot place', async () => {
      // The page being short proves the filter was exhausted. It proves nothing
      // about the rows in it — and an anchor that cannot be placed may be the
      // predecessor itself, in which case trusting the rest of the page signs
      // the window's oldest fill against a staler tick. Same defect as a
      // truncated page, so the same answer, and the size check must not shadow
      // it.
      //
      // Dropping the anchor costs exactly one direction, and it is the cheaper
      // answer as well as the correct one: the window's own fills still have
      // each other to chain against. Letting the unplaceable row through
      // instead would poison the whole response and cost all three, since a row
      // that cannot be placed is not a local problem — which is what makes the
      // order of the two checks here observable rather than academic.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            unsignedSwap('1000', '1.1', '1789950000', '-344100'),
            unsignedSwap('1000', '1.1', '1789900000', '-344250'),
            unsignedSwap('1000', '1.1', '1789850000', '-344300'),
          ],
          anchor: [
            {
              id: 'anchor-broken',
              timestamp: 'not-an-integer',
              logIndex: '5',
              tick: '-344200',
            },
            {
              id: 'anchor-older',
              timestamp: '1789600000',
              logIndex: '4',
              tick: '-344400',
            },
          ],
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      // Only the oldest window fill loses its direction — the one the anchor
      // existed to supply a predecessor for.
      expect(samples.map((s) => s.direction)).toEqual(['buy', 'buy'])
      expect(unparsedSwaps).toBe(1)
    })

    it('refuses to order a block whose fills share a logIndex', async () => {
      // The other way the field can fail to order a block. Uniswap's schema
      // documents it as "index within the txn", so a deployment numbering per
      // transaction rather than per block collides across the block's
      // transactions — indistinguishable from a missing index once two rows
      // claim the same position.
      respondWith({
        data: {
          _meta: meta(),
          pool: pool(),
          swaps: [
            unsignedSwap('1000', '1.1', '1789941299', '-344300', '7'),
            unsignedSwap('1000', '1.1', '1789941299', '-344200', '7'),
          ],
          anchor: [
            {
              id: 'anchor',
              timestamp: '1789700000',
              logIndex: '4',
              tick: '-344400',
            },
          ],
        },
      })

      const { samples, unparsedSwaps } = await fetchSwaps(10)

      expect(samples).toHaveLength(0)
      expect(unparsedSwaps).toBe(2)
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
      expect(url).toContain(DEFAULT_SUBGRAPH_ID)
      expect(apiKey).toBe('a-key')
    })

    it('points at a configured subgraph and still sends the key', () => {
      // Unlike a URL override this names a DEPLOYMENT, not a host: the request
      // still goes to the gateway, so the billed credential is still the right
      // thing to send. That is what lets an operator move off a subgraph whose
      // indexers have died without pasting the secret into a URL.
      const { url, apiKey } = resolveEndpoint(undefined, 'a-key', 'Qm-other-id')

      expect(url).toBe(
        'https://gateway.thegraph.com/api/subgraphs/id/Qm-other-id',
      )
      expect(apiKey).toBe('a-key')
    })

    it('treats a blank subgraph id as unset rather than as an id', () => {
      // `.env.sample` ships `GRAPH_SUBGRAPH_ID=`, and dotenv parses that to `''`,
      // not undefined — so this IS the documented configuration, not a typo. A
      // default parameter does not catch it (it fires only for undefined), and
      // interpolating it would build `…/subgraphs/id/` and query nothing, which
      // takes USDC quoting down in the one case an operator followed the sample
      // exactly.
      for (const blank of ['', '   ']) {
        expect(resolveEndpoint(undefined, 'a-key', blank).url).toBe(
          `https://gateway.thegraph.com/api/subgraphs/id/${DEFAULT_SUBGRAPH_ID}`,
        )
      }
    })

    it('trims a subgraph id an operator pasted with whitespace', () => {
      expect(resolveEndpoint(undefined, 'a-key', '  Qm-other-id\n').url).toBe(
        'https://gateway.thegraph.com/api/subgraphs/id/Qm-other-id',
      )
    })

    it('lets a URL override win over a configured subgraph id', () => {
      // One names a host and the other a deployment on a specific host, so the
      // host is the more specific statement — and the key must not follow it.
      const local = 'http://localhost:8000/subgraphs/name/uniswap-v4'

      expect(resolveEndpoint(local, 'a-key', 'Qm-other-id')).toEqual({
        url: local,
      })
    })

    it('still requires a key for a configured subgraph, which is on the gateway', () => {
      // Changing which subgraph does not change that it is queried through the
      // gateway, so an id without a credential is the same misconfiguration as
      // no id without one.
      expect(() =>
        resolveEndpoint(undefined, undefined, 'Qm-other-id'),
      ).toThrow(SubgraphConfigError)
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

    it('asks for the fields direction-by-tick needs', () => {
      // An indexer that reports unsigned legs leaves the tick as the only place
      // direction survives, and logIndex as the only way to order fills that
      // share a block. Both are standard Uniswap v4 Swap fields and cost
      // nothing on an indexer that signs its amounts.
      expect(RECENT_SWAPS_QUERY).toMatch(/\btick\b/)
      expect(RECENT_SWAPS_QUERY).toMatch(/\blogIndex\b/)
    })

    it('sizes the anchor page by the constant the completeness check reads', () => {
      // The two must not drift: a page sized independently of the check would
      // either never look full or look full when it is not.
      expect(RECENT_SWAPS_QUERY).toMatch(
        new RegExp(`anchor: swaps\\(\\s*first: ${ANCHOR_PAGE_SIZE}\\b`),
      )
    })

    it('asks for the fills immediately before the window as an anchor', () => {
      // `timestamp_lte: $since` is the exact complement of the window's
      // `timestamp_gt: $since` — no gap and no overlap — so the newest anchor is
      // the fill right before the window and gives its oldest row a tick to be
      // compared against.
      expect(RECENT_SWAPS_QUERY).toMatch(
        /anchor: swaps\([\s\S]*?timestamp_lte: \$since/,
      )
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
