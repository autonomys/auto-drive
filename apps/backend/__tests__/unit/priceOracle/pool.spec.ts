import { describe, it, expect } from '@jest/globals'
import { encodeAbiParameters, keccak256 } from 'viem'
import {
  POOL_ID,
  POOL_KEY,
  USDC_ADDRESS,
  WAI3_ADDRESS,
} from '../../../src/infrastructure/services/priceOracle/pool.js'

describe('priceOracle/pool', () => {
  // Uniswap v4 identifies a pool by keccak256(abi.encode(PoolKey)), so this is
  // the one assertion that ties the human-readable components to the id every
  // query is filtered by.
  //
  // It matters most for the currency ORDER. Swapping currency0 and currency1
  // inverts every price the oracle derives, and would do so silently: the
  // numbers stay plausible, the guards stay quiet, and only the charges are
  // wrong. Nothing else in the suite would catch it.
  it('hashes POOL_KEY to POOL_ID', () => {
    const encoded = encodeAbiParameters(
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
    )

    expect(keccak256(encoded)).toBe(POOL_ID)
  })

  it('orders the currencies as v4 requires (ascending by address)', () => {
    expect(POOL_KEY.currency0).toBe(WAI3_ADDRESS)
    expect(POOL_KEY.currency1).toBe(USDC_ADDRESS)
    expect(WAI3_ADDRESS.toLowerCase() < USDC_ADDRESS.toLowerCase()).toBe(true)
  })
})
