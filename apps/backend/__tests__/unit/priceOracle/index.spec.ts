import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { priceOracle } from '../../../src/infrastructure/services/priceOracle/index.js'
import { SubgraphConfigError } from '../../../src/infrastructure/services/priceOracle/subgraph.js'
import type { SwapSample } from '../../../src/infrastructure/services/priceOracle/types.js'

// Defaults from config: cacheTtlMs 60s, maxStaleMs 600s, requestTimeoutMs 10s,
// row cap 1000 / floor 5, window 7d, max swap age 24h, max index lag 15min, min
// window volume 1000 USDC, outlier trim at 25%, bounds [0.0001, 100] USD/AI3.
const TTL_MS = 60_000
const MAX_STALE_MS = 600_000
const MAX_SWAP_AGE_MS = 86_400_000
const MAX_WINDOW_AGE_MS = 604_800_000
const MAX_WINDOW_SAMPLES = 1000
const MAX_INDEX_LAG_MS = 900_000

const PRICE = 6_400_000_000_000_000n // 0.0064 USD/AI3, scaled 1e18
// The pool's real USDC balance on 2026-08-11, in base units — above the 1000 USDC
// depth floor, having been at zero five days earlier.
const POOL_DEPTH = 2_898_005_731n
const BLOCK = 21_000_000n

// A swap of 50,000 AI3 for 320 USDC — 0.0064 USD/AI3. Five of these clear the
// 1000 USDC window-volume floor, so a healthy fixture is five of them.
const AI3_PER_SWAP = 50_000n * 10n ** 18n
const USDC_PER_SWAP = 320_000_000n

const swapsAt = (
  count: number,
  timestampMs: number,
  usdcAmount: bigint = USDC_PER_SWAP,
  direction: SwapSample['direction'] = 'sell',
): SwapSample[] =>
  Array.from({ length: count }, (_, i) => ({
    usdcAmount,
    ai3Amount: AI3_PER_SWAP,
    direction,
    // Spread backwards an hour apart, so `newest` is the one at timestampMs and
    // the window clears the 2h minimum span.
    timestampMs: timestampMs - i * 3_600_000,
  }))

// This pool's real fills, read from the gateway on 2026-08-10 and ordered newest
// first, as [AI3 whole tokens, USDC whole tokens, seconds before now]. Volume is
// doubled and the timestamps compressed so that the freshness and volume guards
// pass and the price TREND is the only thing under test — the prices themselves
// are exactly what the pool filled at, falling 59% across the window.
const LIVE_DOWNTREND: [number, number, number][] = [
  [199392.024, 477.128529, 600],
  [91895.484, 286.993475, 3600],
  [35931.88, 127.829951, 7200],
  [118194.35, 501.438685, 10800],
  [8120.565, 39.943132, 14400],
  [29431.44, 151.891229, 18000],
  [10000.0013, 54.31106, 21600],
  [10000, 55.773014, 25200],
  [10000, 57.29481, 28800],
  [10000, 58.879753, 32400],
]

const liveDowntrendAt = (now: number): SwapSample[] =>
  LIVE_DOWNTREND.map(([ai3, usdc, secondsAgo]) => ({
    // x2 volume, via whole tokens -> base units without float error at 1e18.
    ai3Amount: BigInt(Math.round(ai3 * 2 * 1e6)) * 10n ** 12n,
    usdcAmount: BigInt(Math.round(usdc * 2 * 1e6)),
    // Every one of these ten really was a sell — WAI3 in, USDC out — which is
    // what a pool being drained looks like rather than a market with two sides.
    direction: 'sell' as const,
    timestampMs: now - secondsAgo * 1000,
  }))

const windowAt = (
  now: number,
  overrides: {
    samples?: SwapSample[]
    indexerTimestampMs?: number
    indexerBlock?: bigint
    hasIndexingErrors?: boolean
    unparsedSwaps?: number
    truncated?: boolean
    poolUsdcDepth?: bigint
  } = {},
) => ({
  samples: overrides.samples ?? swapsAt(5, now - 60_000),
  indexerBlock: overrides.indexerBlock ?? BLOCK,
  indexerTimestampMs: overrides.indexerTimestampMs ?? now - 12_000,
  hasIndexingErrors: overrides.hasIndexingErrors ?? false,
  unparsedSwaps: overrides.unparsedSwaps ?? 0,
  truncated: overrides.truncated ?? false,
  // What the pool actually held on 2026-08-11: 2898.005731 USDC.
  poolUsdcDepth: overrides.poolUsdcDepth ?? POOL_DEPTH,
})

const mockWindow = (
  build: (now: number) => ReturnType<typeof windowAt> = (now) => windowAt(now),
) =>
  jest
    .spyOn(priceOracle._internal, 'fetchRecentSwaps')
    .mockImplementation(async () => build(Date.now()))

// Every test here stubs the adapter, so nothing should ever reach `fetch`. That
// is asserted rather than assumed: `config` reads a developer's .env at import,
// so a test that forgot to stub would quietly query the live gateway — and pass
// or fail depending on whether the pool traded this week.
const failOnUnstubbedFetch = () =>
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    throw new Error(`unstubbed network call to ${String(input)}`)
  })

describe('priceOracle.getPrice', () => {
  beforeEach(() => {
    priceOracle._reset()
    failOnUnstubbedFetch()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('returns the volume-weighted average of the recent swaps', async () => {
    mockWindow()

    const result = await priceOracle.getPrice()

    expect(result.isOk()).toBe(true)
    const price = result._unsafeUnwrap()
    expect(price.usdPerAi3).toBe(PRICE)
    expect(price.fromCache).toBe(false)
    expect(price.stale).toBe(false)
  })

  it('weights by size: one big fill outvotes many small ones', async () => {
    // Four small swaps at 0.007 USD/AI3 against one fill at 0.0064 that is
    // three orders of magnitude larger. A count-weighted mean would land near
    // 0.00688; the volume-weighted one sits within 0.004% of the big fill.
    mockWindow((now) => ({
      ...windowAt(now),
      samples: [
        ...Array.from({ length: 4 }, (_, i) => ({
          usdcAmount: 350_000n, // 0.35 USDC
          ai3Amount: 50n * 10n ** 18n, // 50 AI3 -> 0.007 USD/AI3
          direction: 'sell' as const,
          timestampMs: now - 60_000 - i * 3_600_000,
        })),
        {
          usdcAmount: 3_200_000_000n, // 3200 USDC
          ai3Amount: 500_000n * 10n ** 18n, // 500k AI3 -> 0.0064
          direction: 'sell' as const,
          timestampMs: now - 60_000,
        },
      ],
    }))

    const price = (await priceOracle.getPrice())._unsafeUnwrap()

    expect(price.usdPerAi3).toBeGreaterThan(6_400_000_000_000_000n)
    expect(price.usdPerAi3).toBeLessThan(6_401_000_000_000_000n)
  })

  it('refuses rather than mispricing when dust swaps outnumber the real fill', async () => {
    // The trim measures against the MEDIAN, which is count-based: four wash
    // trades at 0.01 make the honest 0.0064 fill the outlier, and it is the one
    // discarded. The result is a refusal (too few samples survive), never a
    // price set by the dust — which is the direction this must fail in. Pinned
    // as a test because it is the known limit of a trade-history oracle on a
    // pool this thin: cheap to deny, not cheap to move.
    mockWindow((now) => ({
      ...windowAt(now),
      samples: [
        ...Array.from({ length: 4 }, (_, i) => ({
          usdcAmount: 500_000n, // 0.5 USDC
          ai3Amount: 50n * 10n ** 18n, // 50 AI3 -> 0.01 USD/AI3
          direction: 'sell' as const,
          timestampMs: now - 60_000 - i * 3_600_000,
        })),
        {
          usdcAmount: 3_200_000_000n,
          ai3Amount: 500_000n * 10n ** 18n, // 0.0064, 1000x the volume
          direction: 'sell' as const,
          timestampMs: now - 60_000,
        },
      ],
    }))

    const result = await priceOracle.getPrice()

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().reason).toBe('insufficient-samples')
  })

  it('serves subsequent calls from cache within the TTL', async () => {
    const spy = mockWindow()

    const first = await priceOracle.getPrice()
    const second = await priceOracle.getPrice()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(first._unsafeUnwrap().fromCache).toBe(false)
    expect(second._unsafeUnwrap().fromCache).toBe(true)
    expect(second._unsafeUnwrap().usdPerAi3).toBe(PRICE)
  })

  it('refreshes after the TTL expires', async () => {
    const spy = mockWindow()

    await priceOracle.getPrice()
    jest.advanceTimersByTime(TTL_MS + 1)
    await priceOracle.getPrice()

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent refreshes into one upstream query', async () => {
    const spy = mockWindow()

    const [a, b, c] = await Promise.all([
      priceOracle.getPrice(),
      priceOracle.getPrice(),
      priceOracle.getPrice(),
    ])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(a._unsafeUnwrap().usdPerAi3).toBe(PRICE)
    expect(b._unsafeUnwrap().usdPerAi3).toBe(PRICE)
    expect(c._unsafeUnwrap().usdPerAi3).toBe(PRICE)
  })

  it('falls back to the last-good price when a read fails', async () => {
    const spy = mockWindow()
    await priceOracle.getPrice()

    jest.advanceTimersByTime(TTL_MS + 1) // expire cache + clear throttle
    spy.mockRejectedValueOnce(new Error('gateway 503'))
    const result = await priceOracle.getPrice()

    expect(result.isOk()).toBe(true)
    const price = result._unsafeUnwrap()
    expect(price.stale).toBe(true)
    expect(price.fromCache).toBe(false)
    expect(price.usdPerAi3).toBe(PRICE)
  })

  it('throttles upstream during an outage', async () => {
    const spy = mockWindow()
    await priceOracle.getPrice()

    jest.advanceTimersByTime(TTL_MS + 1)
    spy.mockRejectedValueOnce(new Error('gateway 503'))
    await priceOracle.getPrice()
    expect(spy).toHaveBeenCalledTimes(2)

    // Within the throttle window the last-good value is served without another
    // upstream call.
    const stale = await priceOracle.getPrice()
    expect(stale._unsafeUnwrap().stale).toBe(true)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('errors once the last-good price ages past maxStaleMs', async () => {
    const spy = mockWindow()
    await priceOracle.getPrice()

    jest.advanceTimersByTime(MAX_STALE_MS + 1)
    spy.mockRejectedValue(new Error('gateway 503'))
    const result = await priceOracle.getPrice()

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().reason).toBe('gateway')
  })

  describe('guards', () => {
    // With no last-good value to fall back on, the guard's own reason reaches
    // the caller — which is what #747 maps to a status code and #811 renders.
    const refusalReason = async () => {
      const result = await priceOracle.getPrice()
      expect(result.isErr()).toBe(true)
      return result._unsafeUnwrapErr().reason
    }

    it('refuses when the gateway cannot be read', async () => {
      jest
        .spyOn(priceOracle._internal, 'fetchRecentSwaps')
        .mockRejectedValue(new Error('ECONNRESET'))

      expect(await refusalReason()).toBe('gateway')
    })

    it('separates a wrong deployment from an unreachable one', async () => {
      // A stale POOL_ID or a missing GRAPH_API_KEY is fixed by a redeploy, not
      // by waiting, and reporting it as `gateway` would send whoever is paged
      // to The Graph's status page to debug our own constant.
      jest
        .spyOn(priceOracle._internal, 'fetchRecentSwaps')
        .mockRejectedValue(
          new SubgraphConfigError('Subgraph has no pool 0xdead'),
        )

      expect(await refusalReason()).toBe('misconfigured')
    })

    it('asks for a window of time, capped by count', async () => {
      // The order of these two is the guard: time selects the fills and the count
      // only bounds the response. Selecting by count and filtering by age
      // afterwards lets a burst evict the market's history, because filtering can
      // only shrink the count and never reach past it.
      const spy = mockWindow()

      await priceOracle.getPrice()

      expect(spy).toHaveBeenCalledWith(
        {
          sinceMs: Date.now() - MAX_WINDOW_AGE_MS,
          maxSamples: MAX_WINDOW_SAMPLES,
        },
        expect.anything(),
      )
    })

    it('refuses a window that came back at the response cap', async () => {
      // A full page means the fills held are the newest slice of the window, so
      // the median is count-based again — the property selecting by time removes.
      // Refusing names the knob; averaging a slice would look like success.
      mockWindow((now) => windowAt(now, { truncated: true }))

      expect(await refusalReason()).toBe('window-truncated')
    })

    it('refuses when the indexer reports indexing errors', async () => {
      mockWindow((now) => ({ ...windowAt(now), hasIndexingErrors: true }))

      expect(await refusalReason()).toBe('indexer-error')
    })

    it('refuses when the indexer is behind, even with a healthy window', async () => {
      mockWindow((now) => ({
        ...windowAt(now),
        indexerTimestampMs: now - MAX_INDEX_LAG_MS - 1,
      }))

      expect(await refusalReason()).toBe('indexer-lag')
    })

    it('refuses a window with too few swaps', async () => {
      mockWindow((now) => ({ ...windowAt(now), samples: swapsAt(4, now) }))

      expect(await refusalReason()).toBe('insufficient-samples')
    })

    it('refuses when the newest swap is older than the freshness bound', async () => {
      mockWindow((now) => ({
        ...windowAt(now),
        samples: swapsAt(5, now - MAX_SWAP_AGE_MS - 1),
      }))

      expect(await refusalReason()).toBe('stale-window')
    })

    it('does not let ancient fills carry the median and price the window', async () => {
      // The regression this guards: eight fills from long ago at 0.02, two from
      // today at 0.0064. Without a lower bound the eight are the median, the
      // trim discards TODAY's fills as outliers, and a rate from another era is
      // served and charged. The window bound drops them first, leaving two —
      // below the floor, so the oracle refuses.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: [
          ...swapsAt(2, now - 60_000),
          ...Array.from({ length: 8 }, (_, i) => ({
            usdcAmount: 1_000_000_000n,
            ai3Amount: 50_000n * 10n ** 18n, // 0.02 USD/AI3
            direction: 'sell' as const,
            timestampMs: now - 30 * 86_400_000 - i * 3_600_000,
          })),
        ],
      }))

      expect(await refusalReason()).toBe('insufficient-samples')
    })

    it('refuses a burst of fills that never held a price', async () => {
      // Six fills inside ten minutes: enough of them, enough volume, all fresh —
      // and printable on demand by anyone willing to trade against themselves.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: Array.from({ length: 6 }, (_, i) => ({
          usdcAmount: USDC_PER_SWAP,
          ai3Amount: AI3_PER_SWAP,
          direction: 'sell' as const,
          timestampMs: now - 60_000 - i * 120_000, // 2 min apart
        })),
      }))

      expect(await refusalReason()).toBe('narrow-window')
    })

    it('judges freshness on the newest swap, not the window span', async () => {
      // Five swaps an hour apart: the oldest is 5h back, well inside the bound,
      // and the window is served.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: swapsAt(5, now - 1000),
      }))

      const result = await priceOracle.getPrice()

      expect(result.isOk()).toBe(true)
    })

    it('refuses when the outlier trim leaves too few swaps', async () => {
      mockWindow((now) => ({
        ...windowAt(now),
        samples: [
          ...swapsAt(3, now - 60_000),
          // Two swaps at 10x the median price: trimmed, leaving 3 < floor of 5.
          ...swapsAt(2, now - 60_000, USDC_PER_SWAP * 10n),
        ],
      }))

      expect(await refusalReason()).toBe('insufficient-samples')
    })

    it('refuses when the market has re-priced past the window', async () => {
      // The defect this closes, taken from this pool's own history rather than
      // invented: the price fell 59% across the window, so the fills carrying
      // the NEW price were the minority — and a count-based median trims the
      // minority. The seven survivors average 0.004698 USD/AI3 while the pool's
      // most recent fill was 0.002393, a rate 96% above anything that traded,
      // and it clears every other guard (7 samples, 1839 USDC, spanning 6h, in
      // bounds). Charging at the old regime is the one outcome worse than not
      // quoting, so the newest fill gets a veto.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: liveDowntrendAt(now),
      }))

      expect(await refusalReason()).toBe('market-moved')
    })

    it('vetoes when a fill sharing the newest timestamp was trimmed', async () => {
      // Same-block swaps share a timestamp — 7 of this pool's timestamps carry
      // more than one fill. Comparing the surviving maximum against the window's
      // maximum cannot see that: trim one of a pair and both maxima stay equal,
      // so the veto reported the window as intact exactly when the market's
      // latest print had been discarded. Which is what a sandwich produces.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: [
          ...swapsAt(5, now - 60_000),
          // A second fill at the same instant as the newest, at twice the price.
          { ...swapsAt(1, now - 60_000, USDC_PER_SWAP * 2n)[0] },
        ],
      }))

      expect(await refusalReason()).toBe('market-moved')
    })

    it('trims an outlier tied to an older fill without vetoing', async () => {
      // The tie only matters at the newest timestamp. Sharing one with an older
      // fill is the ordinary outlier case, and the trim keeps doing its job.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: [
          ...swapsAt(5, now - 60_000),
          {
            ...swapsAt(1, now - 60_000 - 4 * 3_600_000, USDC_PER_SWAP * 2n)[0],
          },
        ],
      }))

      const result = await priceOracle.getPrice()

      expect(result.isOk()).toBe(true)
      expect(priceOracle.getHealth().window).toMatchObject({
        sampleCount: 5,
        droppedOutliers: 1,
      })
    })

    it('still trims an outlier that is not the newest fill', async () => {
      // The veto must not cost the trim its original job. One absurd print in
      // the middle of the window is dropped and the rest prices as before,
      // because the market's latest fill still agrees with the median.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: [
          ...swapsAt(3, now - 60_000),
          ...swapsAt(1, now - 60_000 - 3 * 3_600_000, USDC_PER_SWAP * 10n),
          ...swapsAt(3, now - 60_000 - 4 * 3_600_000),
        ],
      }))

      const result = await priceOracle.getPrice()

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().usdPerAi3).toBe(PRICE)
      expect(priceOracle.getHealth().window).toMatchObject({
        sampleCount: 6,
        droppedOutliers: 1,
      })
    })

    it('prices a market that moved within the trim band', async () => {
      // Volatility is not a regime change: a newest fill 20% off the median
      // survives the trim, so it votes instead of vetoing.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: [
          ...swapsAt(1, now - 60_000, (USDC_PER_SWAP * 80n) / 100n),
          ...swapsAt(4, now - 60_000 - 3_600_000),
        ],
      }))

      const result = await priceOracle.getPrice()

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().usdPerAi3).toBeLessThan(PRICE)
    })

    it('refuses a window that traded below the volume floor', async () => {
      // Five swaps totalling 50 USDC — well-formed, fresh, and meaningless.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: swapsAt(5, now - 60_000, 10_000_000n).map((s) => ({
          ...s,
          ai3Amount: AI3_PER_SWAP / 32n,
        })),
      }))

      expect(await refusalReason()).toBe('thin-volume')
    })

    it('refuses a pool that holds too little to be priced from', async () => {
      // Volume is what traded and can be churned in a circle for the fee; depth
      // has to be put there and left. The pool was at zero USDC on 2026-08-06,
      // which is the state this refuses on.
      mockWindow((now) => windowAt(now, { poolUsdcDepth: 0n }))

      expect(await refusalReason()).toBe('thin-liquidity')
    })

    it('separates a shallow pool from a quiet one', async () => {
      // Both are "the market is not there", and an operator needs to know which:
      // one waits for LPs, the other for traders. Depth is judged first because it
      // needs no sample at all.
      mockWindow((now) =>
        windowAt(now, { poolUsdcDepth: 0n, samples: swapsAt(1, now - 60_000) }),
      )

      expect(await refusalReason()).toBe('thin-liquidity')
    })

    it('judges the volume floor one-sided, so a round trip cannot count twice', async () => {
      // Six fills that would total 1920 USDC — comfortably over the 1000 floor —
      // but they are three buys and three sells of the same size, i.e. a round
      // trip repeated. Capital committed is one side of that, and one side is 960.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: [
          ...swapsAt(3, now - 60_000, USDC_PER_SWAP, 'buy'),
          ...swapsAt(3, now - 60_000 - 3 * 3_600_000, USDC_PER_SWAP, 'sell'),
        ],
      }))

      expect(await refusalReason()).toBe('thin-volume')
    })

    it('refuses a price outside the sanity bounds', async () => {
      // 1000 USDC for 1 AI3 — above the 100 USD/AI3 ceiling.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: swapsAt(5, now - 60_000, 1_000_000_000n).map((s) => ({
          ...s,
          ai3Amount: 10n ** 18n,
        })),
      }))

      expect(await refusalReason()).toBe('out-of-bounds')
    })

    it('treats a window thinned by unparseable rows as thin, not as an outage', async () => {
      // Dropped rows can only shrink the window, so the sample floor is what
      // refuses. What must NOT happen is the old behaviour, where one malformed
      // amount failed the whole response and was reported as `gateway`.
      mockWindow((now) => ({
        ...windowAt(now, { unparsedSwaps: 6 }),
        samples: swapsAt(4, now - 60_000),
      }))

      expect(await refusalReason()).toBe('insufficient-samples')
    })

    it('still prices a window that lost a row to an unparseable amount', async () => {
      mockWindow((now) => windowAt(now, { unparsedSwaps: 1 }))

      const result = await priceOracle.getPrice()

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().usdPerAi3).toBe(PRICE)
    })

    it('reports its own broken invariant as its own, not as an outage', async () => {
      // A zero AI3 leg is impossible by the adapter's contract — it drops such
      // rows — so if one arrives, the statistics throw. That is the oracle
      // failing, and it must not be reported as `gateway`: one reason means wait
      // for The Graph, the other means read the stack trace we just logged.
      mockWindow((now) => ({
        ...windowAt(now),
        samples: swapsAt(5, now - 60_000).map((s) => ({
          ...s,
          ai3Amount: 0n,
        })),
      }))

      expect(await refusalReason()).toBe('internal')
    })

    it('does not cache or remember a refused window', async () => {
      mockWindow((now) => ({ ...windowAt(now), samples: swapsAt(4, now) }))

      await priceOracle.getPrice()

      expect(priceOracle.getHealth().window).toBeNull()
      expect(priceOracle.getHealth().lastSuccessAt).toBeNull()
    })
  })
})

describe('priceOracle.getHealth', () => {
  beforeEach(() => {
    priceOracle._reset()
    failOnUnstubbedFetch()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('starts empty', () => {
    expect(priceOracle.getHealth()).toEqual({
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      window: null,
      servingStale: false,
    })
  })

  it('describes the window behind the served rate', async () => {
    mockWindow()
    await priceOracle.getPrice()

    const health = priceOracle.getHealth()

    expect(health.lastSuccessAt).not.toBeNull()
    expect(health.lastFailureReason).toBeNull()
    expect(health.window).toMatchObject({
      usdPerAi3: PRICE,
      sampleCount: 5,
      droppedOutliers: 0,
      volumeUsdc: USDC_PER_SWAP * 5n,
      indexerBlock: BLOCK,
    })
  })

  it('records how the window split by direction', async () => {
    // Nothing judges this, and that is the point: the pool's fee makes a buy
    // print above mid and a sell below, so a lopsided window is biased in a known
    // direction — and its balance cannot be recovered after the fact. This pool
    // has run 153 sells to 83 buys, so the "flow balances out" assumption is a
    // live question rather than a safe one.
    mockWindow((now) => ({
      ...windowAt(now),
      samples: [
        // Sized so the LARGER side clears the volume floor on its own, which is
        // what that floor now judges.
        ...swapsAt(3, now - 60_000, USDC_PER_SWAP, 'buy'),
        ...swapsAt(4, now - 60_000 - 3 * 3_600_000, USDC_PER_SWAP, 'sell'),
      ],
    }))

    await priceOracle.getPrice()

    expect(priceOracle.getHealth().window).toMatchObject({
      sampleCount: 7,
      buyCount: 3,
      sellCount: 4,
    })
  })

  it('keeps the last good window while reporting the current failure', async () => {
    const spy = mockWindow()
    await priceOracle.getPrice()

    jest.advanceTimersByTime(TTL_MS + 1)
    spy.mockRejectedValueOnce(new Error('gateway 503'))
    await priceOracle.getPrice()

    const health = priceOracle.getHealth()

    expect(health.lastFailureReason).toBe('gateway')
    expect(health.window?.usdPerAi3).toBe(PRICE) // the successful one, retained
    expect(health.servingStale).toBe(true)
  })

  it('reports a recovery as recovered, without losing the blip', async () => {
    const spy = mockWindow()
    await priceOracle.getPrice()

    jest.advanceTimersByTime(TTL_MS + 1)
    spy.mockRejectedValueOnce(new Error('gateway 503'))
    await priceOracle.getPrice()

    jest.advanceTimersByTime(TTL_MS + 1)
    await priceOracle.getPrice()

    const health = priceOracle.getHealth()

    // No longer degraded — the current read succeeds.
    expect(health.servingStale).toBe(false)
    // But the failure stays on the record, and stays PAIRED with its reason:
    // clearing one and not the other rendered "last failure 5m ago (null)".
    expect(health.lastFailureAt).not.toBeNull()
    expect(health.lastFailureReason).toBe('gateway')
  })

  it('does not trigger an upstream read', async () => {
    const spy = mockWindow()

    priceOracle.getHealth()

    expect(spy).not.toHaveBeenCalled()
  })
})

/**
 * The DISPLAY profile.
 *
 * These are mostly the mirror image of the strict cases above: each one takes a
 * window the strict profile refuses and asserts the display profile serves it.
 * That inversion IS the contract — if a case here ever starts refusing, the two
 * profiles have collapsed back into one and the estimate goes blank again.
 */
describe('priceOracle.getDisplayPrice', () => {
  const DISPLAY_TTL_MS = 300_000
  const DISPLAY_MAX_STALE_MS = 86_400_000
  const DISPLAY_WINDOW_AGE_MS = 2_592_000_000
  const DISPLAY_MAX_INDEX_LAG_MS = 3_600_000

  beforeEach(() => {
    priceOracle._reset()
    failOnUnstubbedFetch()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('prices a window the strict profile rejects as too few samples', async () => {
    // Two fills. The strict floor is 5, and this is the shape the live pool was
    // actually in on 2026-09-10 — two fills in seven days.
    mockWindow((now) => windowAt(now, { samples: swapsAt(2, now - 60_000) }))

    expect((await priceOracle.getPrice()).isErr()).toBe(true)
    priceOracle._reset()

    const result = await priceOracle.getDisplayPrice()

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().usdPerAi3).toBe(PRICE)
  })

  it('prices a single fill', async () => {
    mockWindow((now) => windowAt(now, { samples: swapsAt(1, now - 60_000) }))

    const result = await priceOracle.getDisplayPrice()

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().usdPerAi3).toBe(PRICE)
  })

  it('prices a pool too shallow and too quiet for the strict floors', async () => {
    // A dust window against an almost-empty pool: $2 of volume below the 1000
    // USDC floor, and 5 USDC of depth below the 1000 USDC floor. Both legs are
    // scaled together so the PRICE stays at 0.0064 and stays inside the sanity
    // bounds — this case is about the depth and volume guards, and a fixture
    // that also tripped the bounds would pass for the wrong reason.
    const dust = (timestampMs: number) => ({
      usdcAmount: 1_000_000n, // 1 USDC
      ai3Amount: 156_250_000_000_000_000_000n, // 156.25 AI3 -> 0.0064 USD/AI3
      direction: 'sell' as const,
      timestampMs,
    })
    mockWindow((now) => ({
      ...windowAt(now),
      samples: [dust(now - 60_000), dust(now - 3_660_000)],
      poolUsdcDepth: 5_000_000n,
    }))

    expect((await priceOracle.getPrice()).isErr()).toBe(true)
    priceOracle._reset()

    expect((await priceOracle.getDisplayPrice()).isOk()).toBe(true)
  })

  it('prices a burst that the strict span guard rejects', async () => {
    // Six fills sharing one timestamp: zero span, which strict refuses as
    // `narrow-window` because a burst is printable on demand.
    mockWindow((now) => ({
      ...windowAt(now),
      samples: Array.from({ length: 6 }, () => ({
        usdcAmount: USDC_PER_SWAP,
        ai3Amount: AI3_PER_SWAP,
        direction: 'sell' as const,
        timestampMs: now - 60_000,
      })),
    }))

    expect((await priceOracle.getPrice()).isErr()).toBe(true)
    priceOracle._reset()

    expect((await priceOracle.getDisplayPrice()).isOk()).toBe(true)
  })

  it('prices a market that has re-priced, where strict vetoes', async () => {
    // The live downtrend: strict refuses this with `market-moved` because the
    // newest fill is an outlier against the median of the rest. For an
    // estimate the newest fill is the point, so it is served.
    mockWindow((now) => ({ ...windowAt(now), samples: liveDowntrendAt(now) }))

    expect((await priceOracle.getPrice()).isErr()).toBe(true)
    priceOracle._reset()

    expect((await priceOracle.getDisplayPrice()).isOk()).toBe(true)
  })

  it('serves a truncated page instead of refusing it', async () => {
    // A full page is the NEWEST fills, which for an estimate is the good half
    // of the window rather than a reason to withhold one.
    mockWindow((now) =>
      windowAt(now, {
        samples: swapsAt(MAX_WINDOW_SAMPLES, now - 60_000),
        truncated: true,
      }),
    )

    expect((await priceOracle.getPrice()).isErr()).toBe(true)
    priceOracle._reset()

    expect((await priceOracle.getDisplayPrice()).isOk()).toBe(true)
  })

  it('reaches back further than the strict window', async () => {
    // A fill three weeks old: outside strict's 7d window and its 24h freshness
    // bound, inside display's 30d.
    const age = 21 * 86_400_000
    expect(age).toBeGreaterThan(MAX_WINDOW_AGE_MS)
    expect(age).toBeGreaterThan(MAX_SWAP_AGE_MS)
    expect(age).toBeLessThan(DISPLAY_WINDOW_AGE_MS)

    mockWindow((now) => windowAt(now, { samples: swapsAt(3, now - age) }))

    const result = await priceOracle.getDisplayPrice()

    expect(result.isOk()).toBe(true)
  })

  // ── What it still refuses ────────────────────────────────────────────────

  it('refuses an empty window', async () => {
    mockWindow((now) => windowAt(now, { samples: [] }))

    const result = await priceOracle.getDisplayPrice()

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().reason).toBe('insufficient-samples')
  })

  it('refuses a window whose only fills are older than 30 days', async () => {
    mockWindow((now) =>
      windowAt(now, { samples: swapsAt(3, now - DISPLAY_WINDOW_AGE_MS - 1) }),
    )

    const result = await priceOracle.getDisplayPrice()

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().reason).toBe('insufficient-samples')
  })

  it('refuses a rate outside the sanity bounds', async () => {
    // A price is a bug in us, not a market condition, when it lands here —
    // and rendering it would be worse than rendering nothing.
    mockWindow((now) =>
      windowAt(now, { samples: swapsAt(5, now - 60_000, 1n) }),
    )

    const result = await priceOracle.getDisplayPrice()

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().reason).toBe('out-of-bounds')
  })

  it('refuses when the indexer is past the display lag bound', async () => {
    mockWindow((now) =>
      windowAt(now, {
        indexerTimestampMs: now - DISPLAY_MAX_INDEX_LAG_MS - 1,
      }),
    )

    const result = await priceOracle.getDisplayPrice()

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().reason).toBe('indexer-lag')
  })

  it('tolerates lag the strict profile refuses', async () => {
    // 30 minutes: past strict's 15-minute bound, inside display's hour.
    mockWindow((now) =>
      windowAt(now, { indexerTimestampMs: now - MAX_INDEX_LAG_MS - 1 }),
    )

    expect((await priceOracle.getPrice()).isErr()).toBe(true)
    priceOracle._reset()

    expect((await priceOracle.getDisplayPrice()).isOk()).toBe(true)
  })

  it('refuses when the subgraph reports indexing errors', async () => {
    mockWindow((now) => windowAt(now, { hasIndexingErrors: true }))

    const result = await priceOracle.getDisplayPrice()

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().reason).toBe('indexer-error')
  })

  // ── Trim behaviour ───────────────────────────────────────────────────────

  it('does not let the trim empty a small window', async () => {
    // Two fills 60% apart. Each is an outlier against their midpoint, so a
    // trim would discard both and turn "the pool traded twice" into "no idea".
    mockWindow((now) => ({
      ...windowAt(now),
      samples: [
        {
          usdcAmount: 320_000_000n,
          ai3Amount: AI3_PER_SWAP,
          direction: 'sell' as const,
          timestampMs: now - 60_000,
        },
        {
          usdcAmount: 640_000_000n,
          ai3Amount: AI3_PER_SWAP,
          direction: 'sell' as const,
          timestampMs: now - 120_000,
        },
      ],
    }))

    const result = await priceOracle.getDisplayPrice()

    expect(result.isOk()).toBe(true)
    // Volume-weighted across both: 960 USDC over 100k AI3 = 0.0096.
    expect(result._unsafeUnwrap().usdPerAi3).toBe(9_600_000_000_000_000n)
  })

  it('still trims one absurd print out of a large window', async () => {
    mockWindow((now) => ({
      ...windowAt(now),
      samples: [
        // One fill at 100x the rest, which the trim must discard.
        {
          usdcAmount: USDC_PER_SWAP * 100n,
          ai3Amount: AI3_PER_SWAP,
          direction: 'sell' as const,
          timestampMs: now - 60_000,
        },
        ...swapsAt(6, now - 120_000),
      ],
    }))

    const result = await priceOracle.getDisplayPrice()

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().usdPerAi3).toBe(PRICE)
  })

  // ── Cache independence from the strict profile ───────────────────────────

  it('caches on its own TTL', async () => {
    const spy = mockWindow()

    await priceOracle.getDisplayPrice()
    jest.advanceTimersByTime(TTL_MS + 1)
    const second = await priceOracle.getDisplayPrice()

    // Past the STRICT ttl but inside the display one: still one upstream read.
    expect(spy).toHaveBeenCalledTimes(1)
    expect(second._unsafeUnwrap().fromCache).toBe(true)

    jest.advanceTimersByTime(DISPLAY_TTL_MS + 1)
    await priceOracle.getDisplayPrice()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('serves a last-good estimate far longer than the strict path would', async () => {
    const spy = mockWindow()
    await priceOracle.getDisplayPrice()

    jest.advanceTimersByTime(DISPLAY_TTL_MS + 1)
    spy.mockRejectedValueOnce(new Error('gateway 503'))
    const stale = await priceOracle.getDisplayPrice()

    expect(stale.isOk()).toBe(true)
    expect(stale._unsafeUnwrap().stale).toBe(true)

    // Past the strict fallback window, still inside the display one.
    expect(DISPLAY_MAX_STALE_MS).toBeGreaterThan(MAX_STALE_MS)
  })

  it('gives up once the last-good estimate ages out', async () => {
    const spy = mockWindow()
    await priceOracle.getDisplayPrice()

    jest.advanceTimersByTime(DISPLAY_MAX_STALE_MS + 1)
    spy.mockRejectedValue(new Error('gateway 503'))
    const result = await priceOracle.getDisplayPrice()

    expect(result.isErr()).toBe(true)
  })

  it('a display outage leaves the strict rate alone', async () => {
    const spy = mockWindow()
    await priceOracle.getPrice()
    await priceOracle.getDisplayPrice()

    // Display fails; strict is inside its TTL and must be untouched by it.
    jest.advanceTimersByTime(DISPLAY_TTL_MS + 1)
    spy.mockRejectedValueOnce(new Error('gateway 503'))
    await priceOracle.getDisplayPrice()

    const strict = await priceOracle.getPrice()
    expect(strict.isOk()).toBe(true)
    expect(strict._unsafeUnwrap().stale).toBe(false)
  })

  it('reports a config error as misconfigured, not as a gateway outage', async () => {
    jest
      .spyOn(priceOracle._internal, 'fetchRecentSwaps')
      .mockRejectedValue(new SubgraphConfigError('no GRAPH_API_KEY'))

    const result = await priceOracle.getDisplayPrice()

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().reason).toBe('misconfigured')
  })

  it('collapses concurrent callers into one upstream read', async () => {
    const spy = mockWindow()

    const [a, b, c] = await Promise.all([
      priceOracle.getDisplayPrice(),
      priceOracle.getDisplayPrice(),
      priceOracle.getDisplayPrice(),
    ])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(a.isOk() && b.isOk() && c.isOk()).toBe(true)
  })

  // ── Isolation from the strict profile's failure record ───────────────────
  //
  // The two profiles share one module and one logger, and must share nothing
  // else. `unavailable()` writes the strict profile's failure state, so a
  // display refusal routed through it would report a healthy charge-oracle as
  // degraded and relabel its refusals — the failure Bugbot found on #823.

  it('a display failure does not mark the strict profile as serving stale', async () => {
    const spy = mockWindow()
    // Strict succeeds and has a fresh last-good.
    expect((await priceOracle.getPrice()).isOk()).toBe(true)
    expect(priceOracle.getHealth().servingStale).toBe(false)

    spy.mockRejectedValueOnce(new Error('gateway 503'))
    expect((await priceOracle.getDisplayPrice()).isErr()).toBe(true)

    // Nothing about the charge oracle changed.
    expect(priceOracle.getHealth().servingStale).toBe(false)
  })

  it('a display failure does not overwrite the strict last-failure pair', async () => {
    const spy = mockWindow((now) =>
      windowAt(now, { samples: swapsAt(2, now - 60_000) }),
    )
    // Strict refuses: too few samples.
    expect((await priceOracle.getPrice()).isErr()).toBe(true)
    expect(priceOracle.getHealth().lastFailureReason).toBe(
      'insufficient-samples',
    )
    const strictFailedAt = priceOracle.getHealth().lastFailureAt

    jest.advanceTimersByTime(1000)
    spy.mockRejectedValueOnce(new Error('gateway 503'))
    expect((await priceOracle.getDisplayPrice()).isErr()).toBe(true)

    // The dashboard must still be describing the guard that closed the CHARGE
    // path, not one that closed an estimate.
    expect(priceOracle.getHealth().lastFailureReason).toBe(
      'insufficient-samples',
    )
    expect(priceOracle.getHealth().lastFailureAt).toEqual(strictFailedAt)
  })

  it('a display failure does not relabel a throttled strict refusal', async () => {
    // The reason a throttled getPrice reports becomes the client-facing quote
    // code (market-moved -> PRICE_UNSTABLE, everything else -> retryable), so
    // an overwritten reason is a wrong answer to the caller, not just a wrong
    // dashboard.
    const spy = mockWindow((now) => ({
      ...windowAt(now),
      samples: liveDowntrendAt(now),
    }))
    const first = await priceOracle.getPrice()
    expect(first._unsafeUnwrapErr().reason).toBe('market-moved')

    spy.mockRejectedValueOnce(new Error('gateway 503'))
    expect((await priceOracle.getDisplayPrice()).isErr()).toBe(true)

    // Still inside the strict retry throttle, so this is served from
    // currentFailureReason rather than a fresh read.
    const throttled = await priceOracle.getPrice()
    expect(throttled._unsafeUnwrapErr().reason).toBe('market-moved')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
