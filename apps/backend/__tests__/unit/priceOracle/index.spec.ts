import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { priceOracle } from '../../../src/infrastructure/services/priceOracle/index.js'
import type {
  PriceSourceAdapter,
  RawQuote,
  SourceQuote,
} from '../../../src/infrastructure/services/priceOracle/types.js'

const quote = (usdPerAi3: bigint | null): SourceQuote => ({
  name: 'coingecko',
  usdPerAi3,
  ok: usdPerAi3 !== null,
})

// Stub adapter for driving the real fetchSources (validation/isolation/timeout).
const stub = (
  name: string,
  quoteOrFetch: RawQuote | (() => Promise<RawQuote>),
): PriceSourceAdapter => ({
  name,
  fetch:
    typeof quoteOrFetch === 'function' ? quoteOrFetch : async () => quoteOrFetch,
})

// Defaults from config: cacheTtlMs 60s, maxStaleMs 600s, minSources 1,
// fetchTimeoutMs 5s, maxSourceAgeMs 300s, bounds [0.0001, 100] USD/AI3.
const TTL_MS = 60_000
const MAX_STALE_MS = 600_000
const FETCH_TIMEOUT_MS = 5_000
const MAX_SOURCE_AGE_MS = 300_000

describe('priceOracle.getPrice', () => {
  beforeEach(() => {
    priceOracle._reset()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('returns the median of healthy sources', async () => {
    jest
      .spyOn(priceOracle._internal, 'fetchSources')
      .mockResolvedValue([
        quote(6_000_000_000_000_000n),
        quote(6_400_000_000_000_000n),
        quote(6_800_000_000_000_000n),
      ])

    const result = await priceOracle.getPrice()

    expect(result.isOk()).toBe(true)
    const price = result._unsafeUnwrap()
    expect(price.usdPerAi3).toBe(6_400_000_000_000_000n)
    expect(price.fromCache).toBe(false)
    expect(price.stale).toBe(false)
  })

  it('serves subsequent calls from cache within the TTL', async () => {
    const spy = jest
      .spyOn(priceOracle._internal, 'fetchSources')
      .mockResolvedValue([quote(6_400_000_000_000_000n)])

    const first = await priceOracle.getPrice()
    const second = await priceOracle.getPrice()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(first._unsafeUnwrap().fromCache).toBe(false)
    expect(second._unsafeUnwrap().fromCache).toBe(true)
    expect(second._unsafeUnwrap().usdPerAi3).toBe(6_400_000_000_000_000n)
  })

  it('refreshes after the TTL expires', async () => {
    const spy = jest
      .spyOn(priceOracle._internal, 'fetchSources')
      .mockResolvedValue([quote(6_400_000_000_000_000n)])

    await priceOracle.getPrice()
    jest.advanceTimersByTime(TTL_MS + 1)
    await priceOracle.getPrice()

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('falls back to the last-good price when a refresh loses its sources', async () => {
    const spy = jest.spyOn(priceOracle._internal, 'fetchSources')
    spy.mockResolvedValueOnce([quote(6_400_000_000_000_000n)]) // healthy
    await priceOracle.getPrice()

    jest.advanceTimersByTime(TTL_MS + 1) // expire cache + clear throttle
    spy.mockResolvedValueOnce([quote(null)]) // all sources fail
    const result = await priceOracle.getPrice()

    expect(result.isOk()).toBe(true)
    const price = result._unsafeUnwrap()
    expect(price.stale).toBe(true)
    expect(price.fromCache).toBe(false)
    expect(price.usdPerAi3).toBe(6_400_000_000_000_000n)
  })

  it('throttles upstream during an outage (serves last-good without re-fetching)', async () => {
    const spy = jest.spyOn(priceOracle._internal, 'fetchSources')
    spy.mockResolvedValueOnce([quote(6_400_000_000_000_000n)]) // initial success
    await priceOracle.getPrice()

    jest.advanceTimersByTime(TTL_MS + 1) // expire cache + clear throttle
    spy.mockResolvedValueOnce([quote(null)]) // refresh #2 loses sources -> stale
    const stale1 = await priceOracle.getPrice()
    expect(stale1._unsafeUnwrap().stale).toBe(true)
    expect(stale1._unsafeUnwrap().fromCache).toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)

    // Still inside the throttle window: must serve last-good WITHOUT a 3rd fetch.
    const stale2 = await priceOracle.getPrice()
    expect(stale2._unsafeUnwrap().stale).toBe(true)
    // The throttle gate serves a stale fallback, not a fresh TTL cache hit.
    expect(stale2._unsafeUnwrap().fromCache).toBe(false)
    expect(stale2._unsafeUnwrap().usdPerAi3).toBe(6_400_000_000_000_000n)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('errors when there is no healthy source and no last-good value', async () => {
    jest
      .spyOn(priceOracle._internal, 'fetchSources')
      .mockResolvedValue([quote(null)])

    const result = await priceOracle.getPrice()

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
  })

  it('errors when the last-good value is older than maxStaleMs', async () => {
    const spy = jest.spyOn(priceOracle._internal, 'fetchSources')
    spy.mockResolvedValueOnce([quote(6_400_000_000_000_000n)])
    await priceOracle.getPrice()

    jest.advanceTimersByTime(MAX_STALE_MS + 1) // last-good now too old
    spy.mockResolvedValueOnce([quote(null)])
    const result = await priceOracle.getPrice()

    expect(result.isErr()).toBe(true)
  })

  it('collapses concurrent refreshes into a single fetch (single-flight)', async () => {
    let resolveFetch: (quotes: SourceQuote[]) => void = () => {}
    const pending = new Promise<SourceQuote[]>((resolve) => {
      resolveFetch = resolve
    })
    const spy = jest
      .spyOn(priceOracle._internal, 'fetchSources')
      .mockReturnValue(pending)

    const first = priceOracle.getPrice()
    const second = priceOracle.getPrice()
    resolveFetch([quote(6_400_000_000_000_000n)])
    const [r1, r2] = await Promise.all([first, second])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(r1._unsafeUnwrap().usdPerAi3).toBe(6_400_000_000_000_000n)
    expect(r2._unsafeUnwrap().usdPerAi3).toBe(6_400_000_000_000_000n)
  })
})

describe('priceOracle fetchSources (validation + isolation)', () => {
  beforeEach(() => {
    priceOracle._reset()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('keeps an in-bounds, fresh quote', async () => {
    const result = await priceOracle._internal.fetchSources([
      stub('a', { usdPerAi3: 6_400_000_000_000_000n }),
    ])
    expect(result).toEqual([
      { name: 'a', usdPerAi3: 6_400_000_000_000_000n, ok: true },
    ])
  })

  it('drops out-of-bounds quotes (too high and too low)', async () => {
    const result = await priceOracle._internal.fetchSources([
      stub('high', { usdPerAi3: 200n * 10n ** 18n }), // > max (100 USD)
      stub('low', { usdPerAi3: 1n }), // < min (0.0001 USD -> 1e14)
    ])
    expect(result.every((q) => !q.ok)).toBe(true)
  })

  it('drops a stale quote whose asOfMs is beyond maxSourceAgeMs', async () => {
    const result = await priceOracle._internal.fetchSources([
      stub('s', {
        usdPerAi3: 6_400_000_000_000_000n,
        asOfMs: Date.now() - (MAX_SOURCE_AGE_MS + 1),
      }),
    ])
    expect(result[0].ok).toBe(false)
  })

  it('isolates a throwing source and still resolves the batch', async () => {
    const result = await priceOracle._internal.fetchSources([
      stub('boom', async () => {
        throw new Error('boom')
      }),
      stub('good', { usdPerAi3: 6_400_000_000_000_000n }),
    ])
    expect(result.find((q) => q.name === 'boom')?.ok).toBe(false)
    expect(result.find((q) => q.name === 'good')?.ok).toBe(true)
  })

  it('drops a source that exceeds the fetch timeout', async () => {
    const result = priceOracle._internal.fetchSources([
      stub('slow', () => new Promise<RawQuote>(() => {})), // never resolves
    ])
    await jest.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1)
    expect((await result)[0].ok).toBe(false)
  })
})
