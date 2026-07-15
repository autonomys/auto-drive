import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { priceOracle } from '../../../src/infrastructure/services/priceOracle/index.js'
import type { RawQuote } from '../../../src/infrastructure/services/priceOracle/types.js'

// Defaults from config: cacheTtlMs 60s, maxStaleMs 600s, fetchTimeoutMs 5s,
// maxSourceAgeMs 300s, bounds [0.0001, 100] USD/AI3.
const TTL_MS = 60_000
const MAX_STALE_MS = 600_000
const FETCH_TIMEOUT_MS = 5_000
const MAX_SOURCE_AGE_MS = 300_000

const PRICE = 6_400_000_000_000_000n // 0.0064 USD/AI3, scaled 1e18

describe('priceOracle.getPrice', () => {
  beforeEach(() => {
    priceOracle._reset()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('returns the fetched CoinGecko price', async () => {
    jest.spyOn(priceOracle._internal, 'fetchQuote').mockResolvedValue(PRICE)

    const result = await priceOracle.getPrice()

    expect(result.isOk()).toBe(true)
    const price = result._unsafeUnwrap()
    expect(price.usdPerAi3).toBe(PRICE)
    expect(price.fromCache).toBe(false)
    expect(price.stale).toBe(false)
  })

  it('serves subsequent calls from cache within the TTL', async () => {
    const spy = jest
      .spyOn(priceOracle._internal, 'fetchQuote')
      .mockResolvedValue(PRICE)

    const first = await priceOracle.getPrice()
    const second = await priceOracle.getPrice()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(first._unsafeUnwrap().fromCache).toBe(false)
    expect(second._unsafeUnwrap().fromCache).toBe(true)
    expect(second._unsafeUnwrap().usdPerAi3).toBe(PRICE)
  })

  it('refreshes after the TTL expires', async () => {
    const spy = jest
      .spyOn(priceOracle._internal, 'fetchQuote')
      .mockResolvedValue(PRICE)

    await priceOracle.getPrice()
    jest.advanceTimersByTime(TTL_MS + 1)
    await priceOracle.getPrice()

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('falls back to the last-good price when a fetch fails', async () => {
    const spy = jest.spyOn(priceOracle._internal, 'fetchQuote')
    spy.mockResolvedValueOnce(PRICE) // healthy
    await priceOracle.getPrice()

    jest.advanceTimersByTime(TTL_MS + 1) // expire cache + clear throttle
    spy.mockResolvedValueOnce(null) // CoinGecko unhealthy
    const result = await priceOracle.getPrice()

    expect(result.isOk()).toBe(true)
    const price = result._unsafeUnwrap()
    expect(price.stale).toBe(true)
    expect(price.fromCache).toBe(false)
    expect(price.usdPerAi3).toBe(PRICE)
  })

  it('throttles upstream during an outage (serves last-good without re-fetching)', async () => {
    const spy = jest.spyOn(priceOracle._internal, 'fetchQuote')
    spy.mockResolvedValueOnce(PRICE) // initial success
    await priceOracle.getPrice()

    jest.advanceTimersByTime(TTL_MS + 1) // expire cache + clear throttle
    spy.mockResolvedValueOnce(null) // fetch #2 fails -> stale
    const stale1 = await priceOracle.getPrice()
    expect(stale1._unsafeUnwrap().stale).toBe(true)
    expect(stale1._unsafeUnwrap().fromCache).toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)

    // Still inside the throttle window: must serve last-good WITHOUT a 3rd fetch.
    const stale2 = await priceOracle.getPrice()
    expect(stale2._unsafeUnwrap().stale).toBe(true)
    // The throttle gate serves a stale fallback, not a fresh TTL cache hit.
    expect(stale2._unsafeUnwrap().fromCache).toBe(false)
    expect(stale2._unsafeUnwrap().usdPerAi3).toBe(PRICE)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('errors when CoinGecko is unhealthy and there is no last-good value', async () => {
    jest.spyOn(priceOracle._internal, 'fetchQuote').mockResolvedValue(null)

    const result = await priceOracle.getPrice()

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
  })

  it('errors when the last-good value is older than maxStaleMs', async () => {
    const spy = jest.spyOn(priceOracle._internal, 'fetchQuote')
    spy.mockResolvedValueOnce(PRICE)
    await priceOracle.getPrice()

    jest.advanceTimersByTime(MAX_STALE_MS + 1) // last-good now too old
    spy.mockResolvedValueOnce(null)
    const result = await priceOracle.getPrice()

    expect(result.isErr()).toBe(true)
  })

  it('collapses concurrent refreshes into a single fetch (single-flight)', async () => {
    let resolveFetch: (value: bigint | null) => void = () => {}
    const pending = new Promise<bigint | null>((resolve) => {
      resolveFetch = resolve
    })
    const spy = jest
      .spyOn(priceOracle._internal, 'fetchQuote')
      .mockReturnValue(pending)

    const first = priceOracle.getPrice()
    const second = priceOracle.getPrice()
    resolveFetch(PRICE)
    const [r1, r2] = await Promise.all([first, second])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(r1._unsafeUnwrap().usdPerAi3).toBe(PRICE)
    expect(r2._unsafeUnwrap().usdPerAi3).toBe(PRICE)
  })
})

describe('priceOracle fetchQuote (validation + failure handling)', () => {
  beforeEach(() => {
    priceOracle._reset()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  const rawFetch =
    (quote: RawQuote) =>
    async (): Promise<RawQuote> =>
      quote

  it('returns an in-bounds, fresh quote', async () => {
    const result = await priceOracle._internal.fetchQuote(
      rawFetch({ usdPerAi3: PRICE }),
    )
    expect(result).toBe(PRICE)
  })

  it('drops an out-of-bounds quote (too high and too low)', async () => {
    expect(
      await priceOracle._internal.fetchQuote(
        rawFetch({ usdPerAi3: 200n * 10n ** 18n }), // > max (100 USD)
      ),
    ).toBeNull()
    expect(
      await priceOracle._internal.fetchQuote(rawFetch({ usdPerAi3: 1n })), // < min (1e14)
    ).toBeNull()
  })

  it('drops a stale quote whose asOfMs is beyond maxSourceAgeMs', async () => {
    const result = await priceOracle._internal.fetchQuote(
      rawFetch({
        usdPerAi3: PRICE,
        asOfMs: Date.now() - (MAX_SOURCE_AGE_MS + 1),
      }),
    )
    expect(result).toBeNull()
  })

  it('returns null (never throws) when the fetch rejects', async () => {
    const result = await priceOracle._internal.fetchQuote(async () => {
      throw new Error('boom')
    })
    expect(result).toBeNull()
  })

  it('drops a quote that exceeds the fetch timeout', async () => {
    const result = priceOracle._internal.fetchQuote(
      () => new Promise<RawQuote>(() => {}), // never resolves
    )
    await jest.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1)
    expect(await result).toBeNull()
  })
})
