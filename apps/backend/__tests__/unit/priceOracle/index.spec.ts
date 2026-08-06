import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
} from 'viem'
import { priceOracle } from '../../../src/infrastructure/services/priceOracle/index.js'
import { POOL_ID } from '../../../src/infrastructure/services/priceOracle/uniswapV4.js'
import {
  PoolEmptyError,
  type RawQuote,
} from '../../../src/infrastructure/services/priceOracle/types.js'

// Defaults from config: cacheTtlMs 60s, maxStaleMs 600s, fetchTimeoutMs 30s,
// maxSourceAgeMs 300s, bounds [0.0001, 100] USD/AI3, twapTtlMs 300s, gate at
// 25% discount / 50% premium.
const TTL_MS = 60_000
const MAX_STALE_MS = 600_000
const FETCH_TIMEOUT_MS = 30_000
const MAX_SOURCE_AGE_MS = 300_000
const TWAP_TTL_MS = 300_000

const PRICE = 6_400_000_000_000_000n // 0.0064 USD/AI3, scaled 1e18
const BLOCK = 21_000_000n
const LIQUIDITY = 55_551_770_868_378_969n // as read from the live pool

// The pool read as `fetchQuote` returns it once validated.
const validated = { usdPerAi3: PRICE, blockNumber: BLOCK }

// Hold the trailing average at the current price, so the manipulation gate sees
// no divergence and stays out of the way.
const mockFlatHistory = (reference: bigint = PRICE) =>
  jest
    .spyOn(priceOracle._internal, 'buildTwapReference')
    .mockResolvedValue(reference)

describe('priceOracle.getPrice', () => {
  beforeEach(() => {
    priceOracle._reset()
    jest.useFakeTimers()
    mockFlatHistory()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('returns the price read from the pool', async () => {
    jest.spyOn(priceOracle._internal, 'fetchQuote').mockResolvedValue(validated)

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
      .mockResolvedValue(validated)

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
      .mockResolvedValue(validated)

    await priceOracle.getPrice()
    jest.advanceTimersByTime(TTL_MS + 1)
    await priceOracle.getPrice()

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('falls back to the last-good price when a fetch fails', async () => {
    const spy = jest.spyOn(priceOracle._internal, 'fetchQuote')
    spy.mockResolvedValueOnce(validated) // healthy
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
    spy.mockResolvedValueOnce(validated) // initial success
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
    spy.mockResolvedValueOnce(validated)
    await priceOracle.getPrice()

    jest.advanceTimersByTime(MAX_STALE_MS + 1) // last-good now too old
    spy.mockResolvedValueOnce(null)
    const result = await priceOracle.getPrice()

    expect(result.isErr()).toBe(true)
  })

  it('collapses concurrent refreshes into a single fetch (single-flight)', async () => {
    let resolveFetch: (value: typeof validated | null) => void = () => {}
    const pending = new Promise<typeof validated | null>((resolve) => {
      resolveFetch = resolve
    })
    const spy = jest
      .spyOn(priceOracle._internal, 'fetchQuote')
      .mockReturnValue(pending)

    const first = priceOracle.getPrice()
    const second = priceOracle.getPrice()
    resolveFetch(validated)
    const [r1, r2] = await Promise.all([first, second])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(r1._unsafeUnwrap().usdPerAi3).toBe(PRICE)
    expect(r2._unsafeUnwrap().usdPerAi3).toBe(PRICE)
  })

  it('never remembers a price that fails the manipulation gate', async () => {
    // The reason this path is gated at all: `cache` and `lastGood` both outlive
    // the block they were read at, so an ungated read would go on being served —
    // and persisted as an intent's locked rate — for ten minutes after the push
    // that produced it had decayed.
    const spy = jest.spyOn(priceOracle._internal, 'fetchQuote')
    spy.mockResolvedValueOnce(validated)
    await priceOracle.getPrice()

    jest.advanceTimersByTime(TTL_MS + 1)
    const pushed = PRICE / 2n // 50% below the trailing average
    spy.mockResolvedValueOnce({ usdPerAi3: pushed, blockNumber: BLOCK + 1n })
    const result = await priceOracle.getPrice()

    // Serves the previous good value as stale, never the pushed one...
    expect(result._unsafeUnwrap().usdPerAi3).toBe(PRICE)
    expect(result._unsafeUnwrap().stale).toBe(true)

    // ...and the pushed value did not become the new last-good either.
    jest.advanceTimersByTime(TTL_MS + 1)
    spy.mockResolvedValueOnce(null)
    const later = await priceOracle.getPrice()
    expect(later._unsafeUnwrap().usdPerAi3).toBe(PRICE)
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

  const raw = (overrides: Partial<RawQuote> = {}): RawQuote => ({
    usdPerAi3: PRICE,
    blockNumber: BLOCK,
    liquidity: LIQUIDITY,
    ...overrides,
  })
  const rawFetch = (quote: RawQuote) => async (): Promise<RawQuote> => quote

  it('returns an in-bounds, fresh quote with the block it came from', async () => {
    const result = await priceOracle._internal.fetchQuote(rawFetch(raw()))
    expect(result).toEqual({ usdPerAi3: PRICE, blockNumber: BLOCK })
  })

  it('drops an out-of-bounds quote (too high and too low)', async () => {
    expect(
      await priceOracle._internal.fetchQuote(
        rawFetch(raw({ usdPerAi3: 200n * 10n ** 18n })), // > max (100 USD)
      ),
    ).toBeNull()
    expect(
      await priceOracle._internal.fetchQuote(
        rawFetch(raw({ usdPerAi3: 1n })), // < min (1e14)
      ),
    ).toBeNull()
  })

  it('drops a stale quote whose asOfMs is beyond maxSourceAgeMs', async () => {
    const result = await priceOracle._internal.fetchQuote(
      rawFetch(raw({ asOfMs: Date.now() - (MAX_SOURCE_AGE_MS + 1) })),
    )
    expect(result).toBeNull()
  })

  it('drops the price reported by a pool with no in-range liquidity', async () => {
    // An empty pool still reports whatever price the last swap left, with nobody
    // able to move it — and the deviation gate cannot catch that, because with no
    // trades spot and the trailing average are the same standing number.
    const result = await priceOracle._internal.fetchQuote(
      rawFetch(raw({ liquidity: 0n })),
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

  // Live pool fee: 1% LP + 0.1% protocol, composed to 10_990 pips.
  const FEE_PIPS = 10_990n

  // The quoter returns input GROSS of that fee, so a zero-slippage trade comes
  // back ~111bps above marginal. These are the gross amounts that net out to a
  // given real execution premium once the fee is removed.
  const GROSS_AT_ZERO_SLIPPAGE = 6_471_118n // -> 0bps impact, 111bps premium
  const GROSS_AT_100_BPS = 6_535_829n // -> 100bps impact
  const GROSS_AT_300_BPS = 6_665_252n // -> 300bps impact

  const observation = (amountIn: bigint, usdPerAi3: bigint = PRICE) => ({
    usdPerAi3,
    amountIn,
    feePips: FEE_PIPS,
    liquidity: LIQUIDITY,
    blockNumber: BLOCK,
    asOfMs: Date.now(),
  })

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
    expect(quote.quotePremiumBps).toBe(111n)
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

  it('reports the slippage a mid-sized trade incurs', async () => {
    jest
      .spyOn(priceOracle._internal, 'readPoolQuote')
      .mockResolvedValue(observation(GROSS_AT_100_BPS))

    const quote = (
      await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)
    )._unsafeUnwrap()

    expect(quote.priceImpactBps).toBe(100n)
    expect(quote.usdcAmount).toBe(GROSS_AT_100_BPS)
  })

  it('prices heavy slippage in rather than refusing the size', async () => {
    // How much a user may buy is enforced upstream against the credit cap. The
    // oracle's job is to say what this size costs — including the slippage it
    // causes — not to veto it.
    jest
      .spyOn(priceOracle._internal, 'readPoolQuote')
      .mockResolvedValue(observation(GROSS_AT_300_BPS))

    const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

    expect(result.isOk()).toBe(true)
    const quote = result._unsafeUnwrap()
    // The slippage is charged, and reported so the caller can show it.
    expect(quote.usdcAmount).toBe(GROSS_AT_300_BPS)
    expect(quote.priceImpactBps).toBe(300n)
  })

  it('still prices a size whose slippage dwarfs the trade', async () => {
    // ~36% slippage is what this pool costs at that size; it is a real quote,
    // not an error condition.
    const grossAt3600Bps = 8_800_000n
    jest
      .spyOn(priceOracle._internal, 'readPoolQuote')
      .mockResolvedValue(observation(grossAt3600Bps))

    const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().priceImpactBps).toBeGreaterThan(3_000n)
  })

  it('never serves a cached or stale price behind a binding quote', async () => {
    // A fresh marginal price is cached, then the pool moves. The quote must
    // reflect the pool read, not the cache: comparing a cached price against a
    // live quoter result would measure elapsed drift as slippage.
    jest.spyOn(priceOracle._internal, 'fetchQuote').mockResolvedValue(validated)
    await priceOracle.getPrice()

    const movedPrice = (PRICE * 13n) / 10n // +30%, inside the premium bound
    const readSpy = jest
      .spyOn(priceOracle._internal, 'readPoolQuote')
      .mockResolvedValue({
        usdPerAi3: movedPrice,
        amountIn: 8_412_453n, // ~0bps impact against the moved price
        feePips: FEE_PIPS,
        liquidity: LIQUIDITY,
        blockNumber: BLOCK,
        asOfMs: Date.now(),
      })

    const quote = (
      await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)
    )._unsafeUnwrap()

    expect(readSpy).toHaveBeenCalled()
    expect(quote.usdPerAi3).toBe(movedPrice)
    expect(quote.priceImpactBps).toBe(0n)
  })

  describe('failure discrimination', () => {
    it('reports the quoter refusing the size as too large', async () => {
      // The shape the mainnet quoter actually produces: NotEnoughLiquidity
      // wrapped in UnexpectedRevertBytes. Built by encoding real revert data
      // rather than by hand-setting decoded fields.
      const errorAbi = [
        {
          type: 'error',
          name: 'UnexpectedRevertBytes',
          inputs: [{ name: 'revertData', type: 'bytes' }],
        },
        {
          type: 'error',
          name: 'NotEnoughLiquidity',
          inputs: [{ name: 'poolId', type: 'bytes32' }],
        },
      ] as const
      const revert = new BaseError('reverted', {
        cause: new ContractFunctionRevertedError({
          abi: errorAbi,
          data: encodeErrorResult({
            abi: errorAbi,
            errorName: 'UnexpectedRevertBytes',
            args: [
              encodeErrorResult({
                abi: errorAbi,
                errorName: 'NotEnoughLiquidity',
                args: [POOL_ID],
              }),
            ],
          }),
          functionName: 'quoteExactOutputSingle',
          message: 'reverted',
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

    it('rejects an amount wider than the pool can accept as invalid', async () => {
      // uint128 exact-output width. Reported as an invalid amount, not leaked
      // out of the adapter's throw as an oracle outage.
      const result = await priceOracle.getExecutableQuote(1n << 200n)
      expect(result._unsafeUnwrapErr().name).toBe('InvalidQuoteAmountError')
    })

    it('refuses a quote that costs less than the spot value it buys', async () => {
      // No real quote can be cheaper than spot — fee and impact both push up.
      // Getting one means the quoter result was misread (a transposed return
      // value, ABI drift), and it is about to become a binding undercharge.
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockResolvedValue(observation(42_000n)) // gasEstimate-shaped, not a price

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    })

    it('refuses an out-of-bounds pool price', async () => {
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockResolvedValue(observation(1_000n, 200n * 10n ** 18n)) // above $100

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    })

    it('refuses pool state from a lagging node', async () => {
      jest.spyOn(priceOracle._internal, 'readPoolQuote').mockResolvedValue({
        ...observation(GROSS_AT_ZERO_SLIPPAGE),
        asOfMs: Date.now() - (MAX_SOURCE_AGE_MS + 1),
      })

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    })

    it('reports an empty pool as an outage, not as an oversized purchase', async () => {
      // Observed live: this pool's sole full-range position was withdrawn, after
      // which the quoter rejected every size in both directions — including
      // 0.001 AI3 — with the same NotEnoughLiquidity it uses for a trade that is
      // merely too big. Classifying that as "buy less" would tell the user to do
      // something that cannot work, and would hide a total outage.
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockRejectedValue(new PoolEmptyError('no in-range liquidity'))

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    })
  })

  describe('manipulation gate', () => {
    beforeEach(() => {
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockResolvedValue(observation(GROSS_AT_ZERO_SLIPPAGE))
    })

    it('refuses to quote when spot has been pushed below the trailing average', async () => {
      // The direction that under-collects: the user is charged for AI3 at a
      // price the treasury may not be able to re-acquire it at.
      mockFlatHistory(PRICE * 2n) // spot is 50% below the average

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error.name).toBe('PriceDeviationError')
      // Signed: negative means spot sits below the average.
      expect((error as { deviationBps?: bigint }).deviationBps).toBe(-5_000n)
      expect((error as { referenceUsdPerAi3?: bigint }).referenceUsdPerAi3).toBe(
        PRICE * 2n,
      )
    })

    it('is asymmetric: the same divergence upward is allowed', async () => {
      // A premium overcharges a user who sees the quote and can decline, so it
      // is bounded loosely. A discount silently under-collects, so it is not.
      // 30% either side of the average: refused below (>25%), served above
      // (<50%).
      mockFlatHistory((PRICE * 100n) / 70n) // spot 30% BELOW the average
      const below = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)
      expect(below._unsafeUnwrapErr().name).toBe('PriceDeviationError')

      priceOracle._reset()
      mockFlatHistory((PRICE * 100n) / 130n) // spot 30% ABOVE the average
      const above = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)
      expect(above.isOk()).toBe(true)
    })

    it('reuses the derived average across quotes within its TTL', async () => {
      // Rebuilding costs an archival state read plus a log query per chunk, and
      // a 24h average cannot move materially in minutes.
      const twapSpy = mockFlatHistory()

      await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)
      await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)
      expect(twapSpy).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(TWAP_TTL_MS + 1)
      // Re-mock so the pool read is fresh at the new clock; otherwise the
      // staleness check refuses the quote before the gate is reached.
      jest
        .spyOn(priceOracle._internal, 'readPoolQuote')
        .mockResolvedValue(observation(GROSS_AT_ZERO_SLIPPAGE))
      await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(twapSpy).toHaveBeenCalledTimes(2)
    })

    it('anchors the window to the block being judged', async () => {
      const twapSpy = mockFlatHistory()

      await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(twapSpy).toHaveBeenCalledWith(BLOCK)
    })

    it('treats a zero average as an unusable baseline, not an infinite deviation', async () => {
      // Reachable without a broken RPC: the price conversion truncates to zero
      // for any sqrtPriceX96 below ~7.9e13, which is still far above v4's
      // MIN_SQRT_PRICE. Dividing by it would throw a RangeError straight out of
      // a function whose contract is to return a Result.
      mockFlatHistory(0n)

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    })

    it('fails closed when the history cannot be read', async () => {
      // A pruned node must not silently leave every quote unguarded.
      jest
        .spyOn(priceOracle._internal, 'buildTwapReference')
        .mockRejectedValue(new Error('missing trie node'))

      const result = await priceOracle.getExecutableQuote(ONE_THOUSAND_AI3)

      expect(result._unsafeUnwrapErr().name).toBe('OracleUnavailableError')
    })
  })
})
