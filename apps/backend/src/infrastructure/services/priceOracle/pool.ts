/**
 * Identity of the pool the oracle prices from: the Uniswap v4 WAI3/USDC pool on
 * Ethereum mainnet.
 *
 * Only identity lives here. The oracle reads this pool's trade history through
 * its subgraph (see ./subgraph.ts) rather than through an RPC node, so nothing
 * in this module talks to a chain — these constants exist to name the pool in a
 * query and to know which leg of a swap is which.
 */

import type { Address, Hex } from 'viem'

export const WAI3_ADDRESS: Address =
  '0x363FCa95F23E10C76ef793D62d92d39e89d83AC1'
export const USDC_ADDRESS: Address =
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

/**
 * Uniswap v4 identifies a pool by the keccak256 hash of its PoolKey rather than
 * by a contract address, so the key below is the pool's full identity.
 *
 * `pool.spec.ts` asserts that these components hash to POOL_ID. That assertion
 * is what pins the currency ordering — swapping currency0/currency1 silently
 * inverts every price derived from this pool, which no other test would catch,
 * and which the adapter's runtime identity check reads this same ordering to
 * detect.
 */
export const POOL_KEY = {
  currency0: WAI3_ADDRESS, // sorts below USDC, so WAI3 is currency0
  currency1: USDC_ADDRESS,
  fee: 10_000, // 1%
  tickSpacing: 200,
  hooks: '0x0000000000000000000000000000000000000000' as Address,
} as const

export const POOL_ID: Hex =
  '0xa65e8c1c28fc60612cb8e2df615cc8612bc6d8a04f96128fbd346df44601b6f6'

/**
 * The subgraph the pool's trade history is read from, on The Graph's
 * decentralized network.
 *
 * Pinned in code rather than configured because it is part of the pool's
 * identity, exactly as POOL_ID is: pointing at a different subgraph is
 * pointing at different data, which is a code review's business and not a
 * deployment's. `GRAPH_SUBGRAPH_URL` overrides it for local mirrors and tests;
 * the API key stays in the environment, being a secret rather than an identity.
 *
 * Verified 2026-08-10 to index the Uniswap v4 PoolManager on Ethereum mainnet
 * and to expose this pool with token0=WAI3 (18dp), token1=USDC (6dp) — the same
 * ordering POOL_KEY pins.
 */
export const SUBGRAPH_ID = 'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G'

export const defaultSubgraphUrl = (): string =>
  `https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`
