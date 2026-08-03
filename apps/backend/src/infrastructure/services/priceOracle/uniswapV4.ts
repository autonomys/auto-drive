import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  http,
  type Address,
  type Hex,
} from 'viem'
import { mainnet } from 'viem/chains'
import { USD_RATE_DECIMALS } from '@auto-drive/models'
import { config } from '../../../config.js'
import type { RawQuote } from './types.js'

/**
 * AI3/USD source: the Uniswap v4 WAI3/USDC pool on Ethereum mainnet.
 *
 * WAI3 is the bridged representation of AI3 on Ethereum, and the pool is quoted
 * in USDC, so the pool price *is* the USD price — there is no second ETH/USD
 * hop to compound error into the quote.
 *
 * Two distinct reads live here, and they answer different questions:
 *
 *  - `fetchUniswapV4Quote` reads `slot0` for the pool's marginal (spot) price.
 *    This is the market rate we persist as `intents.usdRateAtCreation`.
 *  - `quoteUsdcForAi3` asks the v4 Quoter what a *specific* trade would cost.
 *    This is size-aware: it walks the liquidity curve and includes the pool fee,
 *    so it reflects what converting a given intent would actually execute at.
 *
 * The gap between the two is price impact, which `index.ts` turns into a guard.
 */

// --- Pool identity -----------------------------------------------------------

export const WAI3_ADDRESS: Address =
  '0x363FCa95F23E10C76ef793D62d92d39e89d83AC1'
export const USDC_ADDRESS: Address =
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

export const WAI3_DECIMALS = 18
export const USDC_DECIMALS = 6

/**
 * Uniswap v4 identifies a pool by the keccak256 hash of its PoolKey rather than
 * by a contract address, so the key below is the pool's full identity.
 *
 * `hooks` being the zero address is load-bearing information: a v4 pool only
 * has a TWAP if it was deployed with an oracle hook, and this one was not. Every
 * read here is therefore instantaneous state, which is why `index.ts` does the
 * time-averaging itself rather than asking the pool for an average.
 *
 * The unit tests assert that these components hash to POOL_ID. That assertion
 * is what pins the currency ordering — swapping currency0/currency1 silently
 * inverts every price this module produces, which no other test would catch.
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

// Uniswap v4 periphery on Ethereum mainnet.
// https://developers.uniswap.org/contracts/v4/deployments
const STATE_VIEW_ADDRESS: Address = '0x7ffe42c4a5deea5b0fec41c94c136cf115597227'
const QUOTER_ADDRESS: Address = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'

const stateViewAbi = [
  {
    type: 'function',
    name: 'getSlot0',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
  },
] as const

const quoterAbi = [
  {
    type: 'function',
    name: 'quoteExactOutputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

// --- Client ------------------------------------------------------------------

// Built on first use rather than at import so a deployment that never quotes in
// USDC boots without an Ethereum endpoint configured, while one that does quote
// fails immediately with a message naming the missing variable.
let client: ReturnType<typeof createPublicClient> | null = null

const getClient = () => {
  if (client) {
    return client
  }
  const url = config.ethereum.rpcUrl
  if (!url) {
    throw new Error(
      'ETH_CHAIN_ENDPOINT is not set — it is required to read the AI3/USD ' +
        'price from the Uniswap v4 pool',
    )
  }
  // viem's actions take no per-call AbortSignal, so the request bound is set on
  // the transport. The oracle additionally races its own `withTimeout` around
  // these calls; this is what actually aborts the in-flight HTTP request rather
  // than leaving it to run out its own default.
  client = createPublicClient({
    chain: mainnet,
    transport: http(url, { timeout: config.priceOracle.fetchTimeoutMs }),
  })
  return client
}

// --- Price math --------------------------------------------------------------

const Q96_SHIFT = 96n
const Q192 = 1n << (Q96_SHIFT * 2n)

// slot0 stores sqrt(price) in Q64.96, where `price` is currency1 base units per
// currency0 base unit. Converting to a USD_RATE_SCALE-scaled USD-per-AI3 value:
//
//   raw    = sqrtPriceX96^2 / 2^192                    (USDC base per WAI3 base)
//   human  = raw * 10^(WAI3_DECIMALS - USDC_DECIMALS)  (USD per whole AI3)
//   scaled = human * 10^USD_RATE_DECIMALS
//
// folded into one integer expression that multiplies before dividing so no
// precision is lost:
//
//   scaled = sqrtPriceX96^2 * 10^(18 - 6 + 18) / 2^192
const PRICE_SCALE_EXPONENT = BigInt(
  WAI3_DECIMALS - USDC_DECIMALS + USD_RATE_DECIMALS,
)

/**
 * Convert a v4 `sqrtPriceX96` into USD-per-AI3 scaled by USD_RATE_SCALE (1e18).
 * Exported for unit testing against values captured from the live pool.
 */
export const sqrtPriceX96ToUsdPerAi3 = (sqrtPriceX96: bigint): bigint => {
  if (sqrtPriceX96 <= 0n) {
    throw new Error(`Invalid sqrtPriceX96: ${sqrtPriceX96}`)
  }
  return (sqrtPriceX96 * sqrtPriceX96 * 10n ** PRICE_SCALE_EXPONENT) / Q192
}

/**
 * Remove the pool's swap fee from a quoter `amountIn`.
 *
 * `quoteExactOutputSingle` returns the gross input, so the LP fee is baked in
 * and a *zero-slippage* trade still comes back above the marginal cost — for
 * this pool's 1% fee, by ~101bps. Comparing gross input against a fee-free
 * marginal cost therefore reports a price impact that no trade size can get
 * below, which would turn the depth guard into a constant offset rather than a
 * measure of how far the trade moves the pool.
 *
 * v4 states `fee` in hundredths of a bip (1e-6), so the fee-exclusive input is
 * `amountIn * (1e6 - fee) / 1e6`.
 */
export const FEE_DENOMINATOR = 1_000_000n

export const removePoolFee = (amountIn: bigint): bigint =>
  (amountIn * (FEE_DENOMINATOR - BigInt(POOL_KEY.fee))) / FEE_DENOMINATOR

// v4 takes the exact-output amount as a uint128.
const MAX_UINT128 = (1n << 128n) - 1n

const assertQuotableAmount = (ai3Shannons: bigint): void => {
  if (ai3Shannons <= 0n) {
    throw new Error(`Invalid AI3 amount: ${ai3Shannons}`)
  }
  if (ai3Shannons > MAX_UINT128) {
    throw new Error(
      `AI3 amount ${ai3Shannons} exceeds the uint128 exact-output limit`,
    )
  }
}

/**
 * True when `error` is an on-chain revert from the quoter, as opposed to an RPC,
 * transport, timeout, or configuration failure.
 *
 * The distinction matters because it decides which error the caller reports: a
 * revert means the pool genuinely cannot fill the size, while everything else
 * means we could not find out. Collapsing the two makes an Ethereum outage look
 * like a demand problem in logs and metrics.
 */
export const isQuoterRevert = (error: unknown): boolean =>
  error instanceof BaseError &&
  error.walk((e) => e instanceof ContractFunctionRevertedError) !== null

// --- Reads -------------------------------------------------------------------

/**
 * A pool observation, with everything read at a single block.
 *
 * Pinning matters: the marginal price and the quoter result are only comparable
 * if they describe the same pool state. Reading one at `latest` and the other a
 * moment later measures drift as well as slippage, and on a pool that trades a
 * handful of times a day that drift can dominate.
 */
export type PoolObservation = {
  // Marginal price, scaled by USD_RATE_SCALE (1e18).
  usdPerAi3: bigint
  // Gross USDC base units to buy the requested AI3, fee included. Only present
  // when an amount was quoted.
  amountIn?: bigint
  blockNumber: bigint
  asOfMs: number
}

// Resolve the head block once so every subsequent read can pin to it.
const getHeadBlock = async (): Promise<{
  number: bigint
  timestamp: bigint
}> => {
  const block = await getClient().getBlock({ blockTag: 'latest' })
  if (block.number === null) {
    throw new Error('Ethereum node returned a pending block for "latest"')
  }
  return { number: block.number, timestamp: block.timestamp }
}

const readSqrtPriceX96At = async (blockNumber: bigint): Promise<bigint> => {
  const [sqrtPriceX96] = await getClient().readContract({
    address: STATE_VIEW_ADDRESS,
    abi: stateViewAbi,
    functionName: 'getSlot0',
    args: [POOL_ID],
    blockNumber,
  })
  return sqrtPriceX96
}

/**
 * Marginal price at the head block, as a `RawQuote` for the oracle's existing
 * validation pipeline.
 *
 * The block timestamp is reported as `asOfMs` so a lagging RPC node is caught by
 * the same `maxSourceAgeMs` staleness check that any other source is subject to.
 */
export const fetchUniswapV4Quote = async (): Promise<RawQuote> => {
  const head = await getHeadBlock()
  const sqrtPriceX96 = await readSqrtPriceX96At(head.number)
  return {
    usdPerAi3: sqrtPriceX96ToUsdPerAi3(sqrtPriceX96),
    asOfMs: Number(head.timestamp) * 1000,
  }
}

/**
 * Marginal price and executable cost for `ai3Shannons`, both read at the same
 * block.
 *
 * `amountIn` is the gross USDC (6-decimal base units) needed to buy exactly that
 * much WAI3 — inclusive of the pool fee and of the price impact of the trade
 * itself. `zeroForOne` is false because we spend currency1 (USDC) to receive
 * currency0 (WAI3).
 *
 * Throws when the pool cannot fill the size: the quoter reverts rather than
 * returning a partial fill. Use `isQuoterRevert` to tell that apart from an RPC
 * failure.
 */
export const readPoolQuote = async (
  ai3Shannons: bigint,
): Promise<Required<PoolObservation>> => {
  assertQuotableAmount(ai3Shannons)
  const head = await getHeadBlock()
  const publicClient = getClient()

  const [sqrtPriceX96, simulation] = await Promise.all([
    readSqrtPriceX96At(head.number),
    publicClient.simulateContract({
      address: QUOTER_ADDRESS,
      abi: quoterAbi,
      functionName: 'quoteExactOutputSingle',
      args: [
        {
          poolKey: POOL_KEY,
          zeroForOne: false,
          exactAmount: ai3Shannons,
          hookData: '0x',
        },
      ],
      blockNumber: head.number,
    }),
  ])

  const [amountIn] = simulation.result
  return {
    usdPerAi3: sqrtPriceX96ToUsdPerAi3(sqrtPriceX96),
    amountIn,
    blockNumber: head.number,
    asOfMs: Number(head.timestamp) * 1000,
  }
}

/**
 * Marginal prices sampled backwards from `blockNumber`, newest first, spaced
 * `spacingBlocks` apart.
 *
 * Feeds the manipulation gate in index.ts: the pool has no oracle hook, so there
 * is no TWAP to ask for, and sampling historical blocks is the closest
 * equivalent available. Requires an RPC with state at that depth — a pruned node
 * rejects the older reads, which surfaces as an unavailable oracle rather than a
 * silently unguarded quote.
 */
export const sampleUsdPerAi3 = async (
  blockNumber: bigint,
  samples: number,
  spacingBlocks: number,
): Promise<bigint[]> => {
  const offsets = Array.from(
    { length: samples },
    (_, i) => BigInt(i) * BigInt(spacingBlocks),
  ).filter((offset) => offset < blockNumber)

  return Promise.all(
    offsets.map(async (offset) =>
      sqrtPriceX96ToUsdPerAi3(await readSqrtPriceX96At(blockNumber - offset)),
    ),
  )
}
