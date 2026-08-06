import { describe, it, expect } from '@jest/globals'
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeAbiParameters,
  encodeErrorResult,
  keccak256,
  toEventSelector,
  type Hex,
} from 'viem'
import {
  POOL_ID,
  POOL_KEY,
  SWAP_EVENT,
  USDC_ADDRESS,
  WAI3_ADDRESS,
  effectiveFeePips,
  isQuoterRevert,
  removePoolFee,
  sqrtPriceX96ToUsdPerAi3,
} from '../../../src/infrastructure/services/priceOracle/uniswapV4.js'

describe('priceOracle/uniswapV4 — pool identity', () => {
  // A v4 poolId is the keccak256 of the abi-encoded PoolKey, so this pins every
  // component of the key at once. It is the only check that catches a swapped
  // currency0/currency1, which would silently invert every price we compute
  // while leaving the arithmetic tests passing.
  it('hashes the PoolKey to the live pool id', () => {
    const derived = keccak256(
      encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'address' },
          { type: 'uint24' },
          { type: 'int24' },
          { type: 'address' },
        ],
        [
          POOL_KEY.currency0,
          POOL_KEY.currency1,
          POOL_KEY.fee,
          POOL_KEY.tickSpacing,
          POOL_KEY.hooks,
        ],
      ),
    )
    expect(derived.toLowerCase()).toBe(POOL_ID.toLowerCase())
  })

  it('orders WAI3 as currency0 and USDC as currency1', () => {
    // v4 requires currency0 < currency1 by address.
    expect(BigInt(WAI3_ADDRESS)).toBeLessThan(BigInt(USDC_ADDRESS))
    expect(POOL_KEY.currency0).toBe(WAI3_ADDRESS)
    expect(POOL_KEY.currency1).toBe(USDC_ADDRESS)
  })

  it('pins the Swap event signature to the topic emitted on mainnet', () => {
    // Observed on live PoolManager logs for this pool. A drifted signature is
    // the failure mode with no symptom: it matches no logs, and "no swaps in
    // the window" is exactly what a genuinely quiet pool looks like — so the
    // trailing average would silently collapse to its seed price and the gate
    // would stop reflecting any trading at all.
    expect(toEventSelector(SWAP_EVENT)).toBe(
      '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f',
    )
  })
})

describe('priceOracle/uniswapV4 — sqrtPriceX96 conversion', () => {
  it('converts a slot0 value read from the live pool', () => {
    // Read verbatim from StateView.getSlot0 on mainnet — an odd, full-entropy
    // value rather than one reconstructed from a rounded price, so it exercises
    // the low bits the Q64.96 arithmetic has to carry.
    const quote = sqrtPriceX96ToUsdPerAi3(5_800_964_266_494_512_825_611n)
    expect(quote).toBe(5_360_943_288_753_826n) // $0.005360943288753826
  })

  it('converts a value reconstructed from a known price', () => {
    // Derived as round(sqrt(p / 1e12) * 2^96) for p = $0.0043555041574, so the
    // low bits are zero — it checks the scaling, not the precision.
    const quote = sqrtPriceX96ToUsdPerAi3(5_228_761_106_144_941_834_240n)
    expect(quote).toBe(4_355_504_157_437_379n)
  })

  it('converts an exact round price', () => {
    // 0.005 USD/AI3 -> 5e15 when scaled by 1e18.
    expect(sqrtPriceX96ToUsdPerAi3(5_602_277_097_478_614_417_408n)).toBe(
      5_000_000_000_000_000n,
    )
  })

  it('accounts for the 18/6 decimal difference between WAI3 and USDC', () => {
    // Without the 10^(18-6) correction the result would be off by 1e12, which
    // both bounds checks would happily accept.
    const quote = sqrtPriceX96ToUsdPerAi3(5_602_277_097_478_614_417_408n)
    expect(quote).toBeGreaterThan(10n ** 14n) // > $0.0001
    expect(quote).toBeLessThan(10n ** 20n) // < $100
  })

  it('rejects a non-positive sqrtPriceX96', () => {
    expect(() => sqrtPriceX96ToUsdPerAi3(0n)).toThrow()
    expect(() => sqrtPriceX96ToUsdPerAi3(-1n)).toThrow()
  })
})

describe('priceOracle/uniswapV4 — swap fee', () => {
  // Captured from mainnet slot0: the pool carries a governance-set 0.1%
  // protocol fee on top of its 1% LP fee.
  const LIVE_PROTOCOL_FEE = 4_097_000
  const LIVE_LP_FEE = 10_000

  it('composes the protocol fee with the LP fee', () => {
    // protocolFee packs two 12-bit values; we swap oneForZero, so the high half
    // applies: 1000 + 10000 - (1000*10000/1e6) = 10990 pips = 1.099%.
    expect(effectiveFeePips(LIVE_PROTOCOL_FEE, LIVE_LP_FEE)).toBe(10_990n)
  })

  it('reads the two packed halves independently', () => {
    // Low 12 bits (zeroForOne) must NOT be the ones we use. A pool with a fee
    // only on zeroForOne composes to just the LP fee for our direction.
    expect(effectiveFeePips(0x000, LIVE_LP_FEE)).toBe(10_000n)
    // 2000 pips in the high half, none in the low half.
    expect(effectiveFeePips(2000 << 12, LIVE_LP_FEE)).toBe(11_980n)
  })

  it('is a no-op composition when no protocol fee is set', () => {
    expect(effectiveFeePips(0, 3_000)).toBe(3_000n)
  })

  it('brings a real quoter result back to its marginal cost', () => {
    // Captured together from mainnet: buying 100 AI3 quoted 542_123 USDC base
    // units against a spot value of 536_095. These are independent observations,
    // not values derived from removePoolFee, so this asserts the real
    // relationship rather than restating the implementation.
    const marginal = 536_095n
    const quoterAmountIn = 542_123n

    const netOfFee = removePoolFee(
      quoterAmountIn,
      effectiveFeePips(LIVE_PROTOCOL_FEE, LIVE_LP_FEE),
    )

    // Stripping the fee should leave essentially the spot value: a trade this
    // small barely moves the pool, so what remains is ~1bp of real impact.
    const impactBps = ((netOfFee - marginal) * 10_000n) / marginal
    expect(impactBps).toBe(1n)
  })

  it('would report ~10bps of phantom impact if the protocol fee were ignored', () => {
    // Regression guard: assuming the static 1% LP fee leaves a constant offset
    // in every measurement, which is exactly what removePoolFee exists to
    // remove. If this ever equals the value above, the live fee is being
    // dropped again.
    const marginal = 536_095n
    const lpFeeOnly = removePoolFee(542_123n, BigInt(POOL_KEY.fee))
    const impactBps = ((lpFeeOnly - marginal) * 10_000n) / marginal
    expect(impactBps).toBe(11n)
  })
})

describe('priceOracle/uniswapV4 — isQuoterRevert', () => {
  // These build the error viem would ACTUALLY construct, by encoding real revert
  // data and letting ContractFunctionRevertedError decode it against a real ABI.
  // The previous version of this suite hand-set `data.errorName`, which asserted
  // that the classifier reads a field rather than that the field is ever
  // populated — and it is not, unless the ABI declares the error.
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
    {
      type: 'error',
      name: 'PoolNotInitialized',
      inputs: [],
    },
  ] as const

  const revertingWith = (data: Hex | undefined) =>
    new BaseError('reverted', {
      cause: new ContractFunctionRevertedError({
        // The classifier decodes against the module's own ABI, so the shape of
        // the error object is all that comes from here.
        abi: errorAbi,
        data,
        functionName: 'quoteExactOutputSingle',
        message: 'reverted',
      }),
    })

  const notEnoughLiquidity = encodeErrorResult({
    abi: errorAbi,
    errorName: 'NotEnoughLiquidity',
    args: [POOL_ID],
  })

  it('recognises the pool refusing the size, as the quoter actually reports it', () => {
    // Captured from mainnet: the quoter runs the swap inside poolManager.unlock
    // and re-throws revert bytes it did not expect, so the liquidity error
    // arrives WRAPPED rather than at the top level.
    const wrapped = encodeErrorResult({
      abi: errorAbi,
      errorName: 'UnexpectedRevertBytes',
      args: [notEnoughLiquidity],
    })
    expect(wrapped).toContain('7a5ed734') // NotEnoughLiquidity selector, inside
    expect(isQuoterRevert(revertingWith(wrapped))).toBe(true)
  })

  it('recognises the unwrapped form too', () => {
    // In case a future periphery release stops wrapping.
    expect(isQuoterRevert(revertingWith(notEnoughLiquidity))).toBe(true)
  })

  it('does not treat an unrelated revert as a size problem', () => {
    // A wrong pool key or a hook revert means the integration is broken, not
    // that the buyer should purchase less.
    const unrelated = encodeErrorResult({
      abi: errorAbi,
      errorName: 'PoolNotInitialized',
    })
    expect(isQuoterRevert(revertingWith(unrelated))).toBe(false)
    // Nor does an unrelated error wrapped in the same envelope.
    expect(
      isQuoterRevert(
        revertingWith(
          encodeErrorResult({
            abi: errorAbi,
            errorName: 'UnexpectedRevertBytes',
            args: [unrelated],
          }),
        ),
      ),
    ).toBe(false)
    // Nor an envelope carrying bytes that decode to nothing at all.
    expect(
      isQuoterRevert(
        revertingWith(
          encodeErrorResult({
            abi: errorAbi,
            errorName: 'UnexpectedRevertBytes',
            args: ['0xdeadbeef'],
          }),
        ),
      ),
    ).toBe(false)
    // An empty revert carries no evidence either way.
    expect(isQuoterRevert(revertingWith(undefined))).toBe(false)
  })

  it('does not treat transport failures as reverts', () => {
    expect(isQuoterRevert(new Error('fetch failed: ECONNREFUSED'))).toBe(false)
    expect(isQuoterRevert(new BaseError('HTTP request failed'))).toBe(false)
    expect(isQuoterRevert(undefined)).toBe(false)
  })
})
