import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { BaseError, ContractFunctionRevertedError } from 'viem'
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
  // base units at the marginal (fee-free) price.
  const ONE_THOUSAND_AI3 = 10n ** 21n
  const MARGINAL_USDC = 6_400_000n
  const BLOCK = 21_000_000n

  // The quoter returns input GROSS of the pool's 1% fee, so a zero-slippage
  // trade already comes back ~101bps above marginal. These are the gross
  // amounts that net out to a given real slippage once the fee is removed.
  const GROSS_AT_ZERO_SLIPPAGE = 6_464_646n // -> 0bps impact, 101bps premium
  const GROSS_AT_100_BPS = 6_529_294n // -> 100bps impact
  const GROSS_AT_300_BPS = 6_658_586n // -> 300bps impact, over the 200 limit

  const observation = (amountIn: bigint) => ({
    usdPerAi3: PRICE,
    amountIn,
    blockNumber: BLOCK,
    asOfMs: Date.now(),
  })

  // Flat history: the deviation gate sees no movement and stays out of the way.
  const mockFlatHistory = () =>
    jest
      .spyOn(priceOracle._internal, 'sampleUsdPerAi3')
      .mockResolvedValue([PRICE, PRICE, PRICE, PRICE, PRICE])

  beforeEach(() => {
    priceOracle._reset()
    jest.useFakeTimers()
    mockFlatHistory()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('reports zero price impact when only the pool fee separates the quote from marginal', async () => {
    jest
      .spyOn(priceOracle._internal, 'readPoolQuote')
      .mockResolvedValue(observation(GROSS_AT_ZERO_SLIPPAGE))

    const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

    const quote = result._unsafeUnwrap()
    // The charge is the gross amount — the fee is real money we pay.
    expect(quote.usdcAmount).toBe(GROSS_AT_ZERO_SLIPPAGE)
    expect(quote.usdcAmount).toBeGreaterThan(MARGINAL_USDC)
    // ...but it is not depth, so it must not count against the depth guard.
    expect(quote.priceImpactBps).toBe(0n)
    expect(quote.quotePremiumBps).toBe(101n)
  })

  it('carries the block and amount it was derived from', async () => {
    jest
      .spyOn(priceOracle._internal, 'readPoolQuote')
      .mockResolvedValue(observation(GROSS_AT_ZERO_SLIPPAGE))

    const quote = (
      await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)
    )._unsafeUnwrap()

    expect(quote.blockNumber).toBe(BLOCK)
    expect(quote.ai3Shannons).toBe(ONE_THOUSAND_AI3)
    expect(quote.usdPerAi3).toBe(PRICE)
    expect(quote.asOf).toBeInstanceOf(Date)
  })

  it('admits real slippage below the limit', async () => {
    jest
      .spyOn(priceOracle._internal, 'readPoolQuote')
      .mockResolvedValue(observation(GROSS_AT_100_BPS))

    const quote = (
      await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)
    )._unsafeUnwrap()

    expect(quote.priceImpactBps).toBe(100n)
    expect(quote.usdcAmount).toBe(GROSS_AT_100_BPS)
  })

  it('rejects a conversion whose price impact exceeds the limit', async () => {
    jest
      .spyOn(priceOracle._internal, 'readPoolQuote')
      .mockResolvedValue(observation(GROSS_AT_300_BPS))

    const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.name).toBe('QuoteTooLargeError')
    expect((error as { priceImpactBps?: bigint }).priceImpactBps).toBe(300n)
  })

  it('never serves a cached or stale price behind a binding quote', async () => {
    // A fresh marginal price is cached, then the pool moves. The quote must
    // reflect the pool read, not the cache: comparing a cached price against a
    // live quoter result would measure elapsed drift as slippage.
    jest.spyOn(priceOracle._internal, 'fetchQuote').mockResolvedValue(PRICE)
    await priceOracle.getPrice()

    const movedPrice = PRICE * 2n
    const readSpy = jest
      .spyOn(priceOracle._internal, 'readPoolQuote')
      .mockResolvedValue({
        usdPerAi3: movedPrice,
        amountIn: 12_929_292n, // ~0bps impact against the moved price
        blockNumber: BLOCK,
        asOfMs: Date.now(),
      })
    jest
      .spyOn(priceOracle._internal, 'sampleUsdPerAi3')
      .mockResolvedValue([movedPrice, movedPrice, movedPrice])

    const quote = (
      await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)
    )._unsafeUnwrap()

    expect(readSpy).toHaveBeenCalled()
    expect(quote.usdPerAi3).toBe(movedPrice)
    expect(quote.priceImpactBps).toBe(0n)
  })

  describe('failure discrimination', () => {
    it('reports an on-chain revert as too large', async () => {
      // Shaped like a viem revert; isQuoterRevert walks for the revert cause.
      const revert = Object.assign(new BaseError('reverted'), {
        walk: () =>
          new ContractFunctionRevertedError({
            abi: [],
            functionName: 'quoteExactOutputSingle',
            message: 'NotEnoughLiquidity',
          }),
      })
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockRejectedValue(revert)

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result._unsafeUnwrapErr().name).toBe('QuoteTooLargeError')
    })

    it('reports an RPC failure as unavailable, not as too large', async () => {
      // Blaming the buyer's amount for our own outage is the bug this prevents.
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockRejectedValue(new Error('fetch failed: ECONNREFUSED'))

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    })

    it('rejects a non-positive amount as invalid, not as too large', async () => {
      const result = await priceOracle.getExecutableQuote(0n)
      expect(result._unsafeUnwrapErr().name).toBe('InvalidQuoteAmountError')
    })

    it('rejects a sub-dust amount as invalid, not as too large', async () => {
      // Telling someone who asked for too little to reduce their purchase is
      // worse than not answering.
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockResolvedValue(observation(1n))

      const result = await priceOracle.getExecutableQuote(1n)

      expect(result._unsafeUnwrapErr().name).toBe('InvalidQuoteAmountError')
    })

    it('refuses an out-of-bounds pool price', async () => {
      jest.spyOn(priceOracle._internal, 'readPoolQuote').mockResolvedValue({
        usdPerAi3: 200n * 10n ** 18n, // above the 100 USD bound
        amountIn: 1_000n,
        blockNumber: BLOCK,
        asOfMs: Date.now(),
      })

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    })

    it('refuses pool state from a lagging node', async () => {
      jest.spyOn(priceOracle._internal, 'readPoolQuote').mockResolvedValue({
        usdPerAi3: PRICE,
        amountIn: GROSS_AT_ZERO_SLIPPAGE,
        blockNumber: BLOCK,
        asOfMs: Date.now() - (MAX_SOURCE_AGE_MS + 1),
      })

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    })
  })

  describe('spot-deviation gate', () => {
    it('refuses to quote when spot has been pushed away from the recent median', async () => {
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockResolvedValue(observation(GROSS_AT_ZERO_SLIPPAGE))
      // Spot is PRICE; history sits at half that, so spot is ~100% above the
      // median — far beyond the 10% default.
      const half = PRICE / 2n
      jest
        .spyOn(priceOracle._internal, 'sampleUsdPerAi3')
        .mockResolvedValue([half, half, half, half, half])

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error.name).toBe('PriceDeviationError')
      expect((error as { deviationBps?: bigint }).deviationBps).toBe(10_000n)
    })

    it('tolerates a single manipulated sample (median, not mean)', async () => {
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockResolvedValue(observation(GROSS_AT_ZERO_SLIPPAGE))
      // One wild outlier among otherwise flat history must not move the median.
      jest
        .spyOn(priceOracle._internal, 'sampleUsdPerAi3')
        .mockResolvedValue([PRICE, PRICE, PRICE * 50n, PRICE, PRICE])

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result.isOk()).toBe(true)
    })

    it('fails closed when historical state cannot be sampled', async () => {
      // A pruned node must not silently leave every quote unguarded.
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockResolvedValue(observation(GROSS_AT_ZERO_SLIPPAGE))
      jest
        .spyOn(priceOracle._internal, 'sampleUsdPerAi3')
        .mockRejectedValue(new Error('missing trie node'))

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    })
  })
})
