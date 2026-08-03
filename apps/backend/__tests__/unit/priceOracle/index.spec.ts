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

  it('returns the price read from the pool', async () => {
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
    spy.mockResolvedValueOnce(null) // pool read failed
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

  it('errors when the pool cannot be read and there is no last-good value', async () => {
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

  const rawFetch = (quote: RawQuote) => async (): Promise<RawQuote> => quote

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

describe('priceOracle.getExecutableQuote (size-aware quote + depth guard)', () => {
  // 1000 AI3 at the 0.0064 USD/AI3 test price is $6.40, i.e. 6_400_000 USDC
  // base units at the marginal price.
  const ONE_THOUSAND_AI3 = 10n ** 21n
  const MARGINAL_USDC = 6_400_000n
  // config default ORACLE_MAX_PRICE_IMPACT=2 -> 200bps.
  const MAX_IMPACT_BPS = 200n

  beforeEach(() => {
    priceOracle._reset()
    jest.useFakeTimers()
    jest.spyOn(priceOracle._internal, 'fetchQuote').mockResolvedValue(PRICE)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('returns the quoter amount and zero impact when it matches the marginal cost', async () => {
    jest
      .spyOn(priceOracle._internal, 'quoteUsdcForAi3')
      .mockResolvedValue(MARGINAL_USDC)

    const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

    expect(result.isOk()).toBe(true)
    const quote = result._unsafeUnwrap()
    expect(quote.usdcAmount).toBe(MARGINAL_USDC)
    expect(quote.usdPerAi3).toBe(PRICE)
    expect(quote.priceImpactBps).toBe(0n)
  })

  it('charges the executable amount, not the marginal one, within the limit', async () => {
    // +1% over marginal = 100bps, inside the 200bps limit.
    const executable = 6_464_000n
    jest
      .spyOn(priceOracle._internal, 'quoteUsdcForAi3')
      .mockResolvedValue(executable)

    const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

    const quote = result._unsafeUnwrap()
    expect(quote.usdcAmount).toBe(executable)
    expect(quote.usdcAmount).toBeGreaterThan(MARGINAL_USDC)
    expect(quote.priceImpactBps).toBe(100n)
    expect(quote.priceImpactBps).toBeLessThanOrEqual(MAX_IMPACT_BPS)
  })

  it('rejects a conversion whose price impact exceeds the limit', async () => {
    // 6_600_000 over a 6_400_000 marginal cost is 312bps, above the limit.
    jest
      .spyOn(priceOracle._internal, 'quoteUsdcForAi3')
      .mockResolvedValue(6_600_000n)

    const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.name).toBe('QuoteTooLargeError')
    expect((error as { priceImpactBps?: bigint }).priceImpactBps).toBe(312n)
  })

  it('rejects when the pool cannot fill the size at all', async () => {
    // The quoter reverts rather than returning a partial fill.
    jest
      .spyOn(priceOracle._internal, 'quoteUsdcForAi3')
      .mockRejectedValue(new Error('execution reverted'))

    const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().name).toBe('QuoteTooLargeError')
  })

  it('propagates an unavailable oracle rather than quoting blind', async () => {
    jest.spyOn(priceOracle._internal, 'fetchQuote').mockResolvedValue(null)
    const quoterSpy = jest.spyOn(priceOracle._internal, 'quoteUsdcForAi3')

    const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    // No point asking the quoter when there is no rate to measure impact against.
    expect(quoterSpy).not.toHaveBeenCalled()
  })

  it('rejects a non-positive amount', async () => {
    const result = await priceOracle.getExecutableQuote(0n)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().name).toBe('QuoteTooLargeError')
  })
})
