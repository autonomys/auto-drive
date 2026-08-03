import { describe, it, expect } from '@jest/globals'
import { encodeAbiParameters, keccak256 } from 'viem'
import {
  FEE_DENOMINATOR,
  POOL_ID,
  POOL_KEY,
  USDC_ADDRESS,
  WAI3_ADDRESS,
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
})

describe('priceOracle/uniswapV4 — sqrtPriceX96 conversion', () => {
  it('converts a value captured from the live pool', () => {
    // sqrtPriceX96 corresponding to the pool's observed price of
    // ~$0.0043555041574 per AI3.
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

describe('priceOracle/uniswapV4 — pool fee removal', () => {
  it('undoes the 1% fee the quoter includes in amountIn', () => {
    // A trade whose gross input is 1_000_000 base units paid 1% in fee, so the
    // portion attributable to price is 990_000.
    expect(removePoolFee(1_000_000n)).toBe(990_000n)
  })

  it('brings a zero-slippage quote back to its marginal cost', () => {
    // This is the property the depth guard depends on: without it, a trade with
    // no price impact at all still measures ~101bps and the guard becomes a
    // constant offset rather than a measure of depth.
    const marginal = 6_400_000n
    const grossAtZeroSlippage =
      (marginal * FEE_DENOMINATOR) / (FEE_DENOMINATOR - BigInt(POOL_KEY.fee))

    const netOfFee = removePoolFee(grossAtZeroSlippage)

    // Within one base unit of the marginal cost (integer division).
    const delta =
      netOfFee > marginal ? netOfFee - marginal : marginal - netOfFee
    expect(delta).toBeLessThanOrEqual(1n)
  })
})
