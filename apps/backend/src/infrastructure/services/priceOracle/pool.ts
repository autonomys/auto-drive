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
 * The subgraph the pool's trade history is read from — a default, not an
 * identity. `GRAPH_SUBGRAPH_ID` overrides it, so moving off a dead deployment is
 * a restart rather than a release.
 *
 * What is load-bearing is POOL_ID and the currency ordering above. Those stay in
 * code and `assertPoolIdentity` in ./subgraph.ts checks them against every
 * response, so a wrong ID refuses as `misconfigured` instead of pricing from
 * another market.
 *
 * The default is the `uniswap-v4-ethereum` subgraph The Graph's explorer lists
 * for this pool. Verified 2026-09-21: synced to chainhead,
 * `hasIndexingErrors: false`, token0=WAI3 (18dp) and token1=USDC (6dp), 2 active
 * indexers. It reports swap legs signed, as pool deltas.
 *
 * We also run our own, `Autonomys-USDC-Payments`
 * (`HwYM4HPLXKzQmnmxU64m1ak6ChEesPyN3r9b4NDVdo66`), published 2026-09-21 and
 * still syncing Ethereum. An unsynced deployment answers `_meta` and refuses
 * entity queries.
 */
export const DEFAULT_SUBGRAPH_ID =
  'EzLH76FWsZUSBTfp2P6CV7cqN56e1rSt2uWtqtsUMEeb'

/**
 * The gateway URL for a subgraph ID. Takes the ID rather than reading config, so
 * `resolveEndpoint` stays the one place configuration becomes an endpoint.
 *
 * Blank falls back as well as missing: dotenv parses the `GRAPH_SUBGRAPH_ID=`
 * that `.env.sample` ships to `''`, which a default parameter does not catch and
 * which would build `…/subgraphs/id/`.
 */
export const defaultSubgraphUrl = (subgraphId?: string): string =>
  `https://gateway.thegraph.com/api/subgraphs/id/${
    subgraphId?.trim() || DEFAULT_SUBGRAPH_ID
  }`
