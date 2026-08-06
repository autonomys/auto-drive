import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  decodeErrorResult,
  http,
  type Address,
  type Hex,
} from 'viem'
import { mainnet } from 'viem/chains'
import { USD_RATE_DECIMALS } from '@auto-drive/models'
import { config } from '../../../config.js'
import { PoolEmptyError, type PricePoint, type RawQuote } from './types.js'

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
 *  - `readPoolQuote` additionally asks the v4 Quoter what a *specific* trade
 *    would cost. That is size-aware: it walks the liquidity curve and includes
 *    the swap fee, so it reflects what converting an intent would execute at.
 *    Both halves are pinned to one block, since they are only comparable when
 *    they describe the same pool state.
 *
 * The gap between the two, net of the fee, is the execution premium that
 * `index.ts` turns into a depth guard.
 *
 * A third read, `fetchSwapPrices`, reconstructs the pool's price history from
 * `Swap` events rather than from state. Each event carries the price the swap
 * left behind, so a couple of log queries give the exact trade history — which
 * `index.ts` time-weights into the average that the manipulation gate judges
 * spot against.
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

// Uniswap v4 core + periphery on Ethereum mainnet.
// https://developers.uniswap.org/contracts/v4/deployments
const STATE_VIEW_ADDRESS: Address = '0x7ffe42c4a5deea5b0fec41c94c136cf115597227'
const QUOTER_ADDRESS: Address = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'
export const POOL_MANAGER_ADDRESS: Address =
  '0x000000000004444c5dc75cB358380D2e3dE08A90'

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
  {
    type: 'function',
    name: 'getLiquidity',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
] as const

/**
 * The v4 `Swap` event, which is how the price history is read.
 *
 * `sqrtPriceX96` is the price the swap left the pool at, and `id` is indexed, so
 * one filtered `eth_getLogs` returns every price this pool has traded at over a
 * range — served from the log index rather than from archival state.
 *
 * The unit tests pin this signature's topic0 against the value observed on
 * mainnet. That assertion is load-bearing: a drifted signature matches nothing,
 * and "no swaps in the window" is indistinguishable from a genuinely quiet pool,
 * which would silently degrade the average to its seed price alone.
 */
export const SWAP_EVENT = {
  type: 'event',
  name: 'Swap',
  inputs: [
    { name: 'id', type: 'bytes32', indexed: true },
    { name: 'sender', type: 'address', indexed: true },
    { name: 'amount0', type: 'int128', indexed: false },
    { name: 'amount1', type: 'int128', indexed: false },
    { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
    { name: 'liquidity', type: 'uint128', indexed: false },
    { name: 'tick', type: 'int24', indexed: false },
    { name: 'fee', type: 'uint24', indexed: false },
  ],
} as const

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
  // Error fragments, without which viem cannot decode a revert at all: it has no
  // selector to match, so `data` and `reason` both come back undefined and every
  // revert looks alike. `isQuoterRevert` needs them to tell "the pool cannot fill
  // this" apart from "the integration is broken".
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
    name: 'QuoteSwap',
    inputs: [{ name: 'amount', type: 'uint256' }],
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
  // viem's actions take no per-call AbortSignal, so this transport timeout is
  // the ONLY thing that stops an in-flight request. The `withTimeout` races in
  // index.ts bound how long a caller waits for a whole multi-call sequence; they
  // do not abort anything, and a request they give up on runs to completion in
  // the background. Hence two separate settings: this bounds one request, and
  // `fetchTimeoutMs` bounds the sequence.
  client = createPublicClient({
    chain: mainnet,
    transport: http(url, { timeout: config.priceOracle.rpcTimeoutMs }),
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
 * Exported for unit testing against values read from the live pool.
 */
export const sqrtPriceX96ToUsdPerAi3 = (sqrtPriceX96: bigint): bigint => {
  if (sqrtPriceX96 <= 0n) {
    throw new Error(`Invalid sqrtPriceX96: ${sqrtPriceX96}`)
  }
  return (sqrtPriceX96 * sqrtPriceX96 * 10n ** PRICE_SCALE_EXPONENT) / Q192
}

/**
 * Fees are stated in hundredths of a bip (1e-6), so 10_000 is 1%.
 */
export const FEE_DENOMINATOR = 1_000_000n

/**
 * Total swap fee a USDC→WAI3 trade pays, in the same 1e-6 units.
 *
 * A v4 pool charges the LP fee *and* — when governance has switched one on — a
 * protocol fee, composed as `pf + lp - pf*lp/1e6`. `protocolFee` packs two
 * independent values into a uint24: the low 12 bits apply to zeroForOne swaps
 * and the high 12 bits to oneForZero. We spend currency1 to receive currency0,
 * which is oneForZero, hence the shift.
 *
 * This must come from live `slot0` rather than from `POOL_KEY.fee`: the pool
 * currently carries a 0.1% protocol fee on top of its 1% LP fee, and assuming
 * the static 1% leaves ~10bps of phantom "impact" in every measurement — the
 * exact constant offset `removePoolFee` exists to eliminate. Governance can
 * change the protocol fee at any time, so it is read, not hardcoded.
 */
export const effectiveFeePips = (
  protocolFee: number,
  lpFee: number,
): bigint => {
  const oneForZeroProtocolFee = BigInt(protocolFee >> 12)
  const lp = BigInt(lpFee)
  return (
    oneForZeroProtocolFee + lp - (oneForZeroProtocolFee * lp) / FEE_DENOMINATOR
  )
}

/**
 * Remove the swap fee from a quoter `amountIn`.
 *
 * `quoteExactOutputSingle` returns the gross input, so the fee is baked in and a
 * *zero-slippage* trade still comes back above the marginal cost. Comparing
 * gross input against a fee-free marginal cost would report a premium that no
 * trade size can get below, turning the depth guard into a constant offset
 * rather than a measure of the trade's own execution premium.
 */
export const removePoolFee = (amountIn: bigint, feePips: bigint): bigint =>
  (amountIn * (FEE_DENOMINATOR - feePips)) / FEE_DENOMINATOR

// v4 takes the exact-output amount as a uint128.
export const MAX_UINT128 = (1n << 128n) - 1n

const assertQuotableAmount = (ai3Shannons: bigint): void => {
  if (ai3Shannons <= 0n || ai3Shannons > MAX_UINT128) {
    throw new Error(`Unquotable AI3 amount: ${ai3Shannons}`)
  }
}

// v4 reverts with this when a pool lacks the liquidity to fill an exact-output
// swap.
const NOT_ENOUGH_LIQUIDITY = 'NotEnoughLiquidity'
// ...but it almost never arrives under that name. The quoter runs the swap
// inside `poolManager.unlock` and catches the result, so a failure comes back as
// revert bytes it did not expect, re-thrown wrapped: the top-level error is
// `UnexpectedRevertBytes(abi.encodeWithSelector(NotEnoughLiquidity.selector,
// poolId))`. Verified against mainnet — every rejected size, from 0.001 AI3
// upwards, surfaces this way. The unwrapped form is still matched below in case
// a future periphery release stops wrapping.
const UNEXPECTED_REVERT_BYTES = 'UnexpectedRevertBytes'

/**
 * True only when `error` is the pool telling us it cannot fill the requested
 * size.
 *
 * Deliberately narrow. An uninitialised pool key, a hook revert, or a quoter
 * that has been redeployed all revert too, but none of them mean "buy less" —
 * they mean the integration is broken, and reporting them as a size problem
 * both misleads the user and hides a total outage from logs and metrics. So a
 * revert only counts when it decodes to the liquidity error; anything else,
 * including an empty revert, falls through to being treated as unavailable.
 *
 * Matching on the decoded error NAME rather than on message text is what makes
 * that narrowness real: viem populates `data` only for selectors present in the
 * ABI, so the error fragments declared above are what this function runs on.
 */
export const isQuoterRevert = (error: unknown): boolean => {
  if (!(error instanceof BaseError)) {
    return false
  }
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
  if (!(reverted instanceof ContractFunctionRevertedError)) {
    return false
  }
  const errorName = reverted.data?.errorName
  if (errorName === NOT_ENOUGH_LIQUIDITY) {
    return true
  }
  if (errorName !== UNEXPECTED_REVERT_BYTES) {
    return false
  }
  const wrapped = reverted.data?.args?.[0]
  if (typeof wrapped !== 'string') {
    return false
  }
  try {
    return (
      decodeErrorResult({ abi: quoterAbi, data: wrapped as Hex }).errorName ===
      NOT_ENOUGH_LIQUIDITY
    )
  } catch {
    // Bytes we cannot decode are evidence of nothing, so they are not a size
    // problem.
    return false
  }
}

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
  // Gross USDC base units to buy the requested AI3, fee included.
  amountIn: bigint
  // Total swap fee applying to this trade, in 1e-6 units, read from the same
  // block. Live rather than assumed, because the protocol fee is governance-set.
  feePips: bigint
  // In-range liquidity at that block. Zero means `usdPerAi3` is a price nobody
  // can trade at: it is whatever the last swap left behind, held in place by the
  // absence of anyone able to move it. Worth reading even though the quoter
  // reverts on its own in that state, because the marginal price is served and
  // persisted on paths that never call the quoter.
  liquidity: bigint
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

const readSlot0At = async (blockNumber: bigint) =>
  getClient().readContract({
    address: STATE_VIEW_ADDRESS,
    abi: stateViewAbi,
    functionName: 'getSlot0',
    args: [POOL_ID],
    blockNumber,
  })

const readLiquidityAt = async (blockNumber: bigint) =>
  getClient().readContract({
    address: STATE_VIEW_ADDRESS,
    abi: stateViewAbi,
    functionName: 'getLiquidity',
    args: [POOL_ID],
    blockNumber,
  })

/**
 * Marginal price at a given block, scaled by USD_RATE_SCALE (1e18).
 *
 * Seeds the TWAP window: it answers "what price was standing when this window
 * opened", which no log inside the window can tell us. Reaching
 * `ORACLE_TWAP_WINDOW_BLOCKS` back is the one archival STATE read the oracle
 * makes; everything else about the history comes from logs.
 */
export const readUsdPerAi3At = async (blockNumber: bigint): Promise<bigint> => {
  const [sqrtPriceX96] = await readSlot0At(blockNumber)
  return sqrtPriceX96ToUsdPerAi3(sqrtPriceX96)
}

/**
 * Marginal price at the head block, as a `RawQuote` for the oracle's existing
 * validation pipeline.
 *
 * The block timestamp is reported as `asOfMs` so a lagging RPC node is caught by
 * the same `maxSourceAgeMs` staleness check that any other source is subject to.
 * The block number is reported so this price can be put through the same
 * manipulation gate as an executable quote, and the liquidity so a price from an
 * empty pool can be refused.
 */
export const fetchUniswapV4Quote = async (): Promise<RawQuote> => {
  const head = await getHeadBlock()
  const [slot0, liquidity] = await Promise.all([
    readSlot0At(head.number),
    readLiquidityAt(head.number),
  ])
  return {
    usdPerAi3: sqrtPriceX96ToUsdPerAi3(slot0[0]),
    blockNumber: head.number,
    liquidity,
    asOfMs: Number(head.timestamp) * 1000,
  }
}

/**
 * Marginal price, live swap fee and executable cost for `ai3Shannons`, all read
 * at the same block.
 *
 * `amountIn` is the gross USDC (6-decimal base units) needed to buy exactly that
 * much WAI3 — inclusive of the swap fee and of the price impact of the trade
 * itself. `zeroForOne` is false because we spend currency1 (USDC) to receive
 * currency0 (WAI3).
 *
 * Throws when the pool cannot fill the size: the quoter reverts rather than
 * returning a partial fill. Use `isQuoterRevert` to tell that apart from an RPC
 * failure — and note that an EMPTY pool throws `PoolEmptyError` first, since the
 * quoter's revert is identical in both cases and only the liquidity read
 * separates them.
 */
export const readPoolQuote = async (
  ai3Shannons: bigint,
): Promise<PoolObservation> => {
  assertQuotableAmount(ai3Shannons)
  const head = await getHeadBlock()
  const publicClient = getClient()

  // Settled rather than all: a quoter revert must not discard the liquidity
  // read, because that read is the only thing that tells "this pool is too
  // shallow for this size" apart from "this pool is empty". Both revert
  // identically.
  const [slot0Result, liquidityResult, quoteResult] = await Promise.allSettled([
    readSlot0At(head.number),
    readLiquidityAt(head.number),
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

  if (slot0Result.status === 'rejected') {
    throw slot0Result.reason
  }
  if (liquidityResult.status === 'rejected') {
    throw liquidityResult.reason
  }
  const liquidity = liquidityResult.value
  if (liquidity <= 0n) {
    throw new PoolEmptyError(
      `The WAI3/USDC pool has no in-range liquidity at block ${head.number}`,
    )
  }
  if (quoteResult.status === 'rejected') {
    throw quoteResult.reason
  }

  const [sqrtPriceX96, , protocolFee, lpFee] = slot0Result.value
  const [amountIn] = quoteResult.value.result
  return {
    usdPerAi3: sqrtPriceX96ToUsdPerAi3(sqrtPriceX96),
    amountIn,
    feePips: effectiveFeePips(protocolFee, lpFee),
    liquidity,
    blockNumber: head.number,
    asOfMs: Number(head.timestamp) * 1000,
  }
}

/**
 * Every price this pool traded at over `[fromBlock, toBlock]`, in block order.
 *
 * Read from `Swap` events, not from state. That is the difference between a
 * sampled approximation and the real thing: sampling `slot0` at intervals sees
 * only where the price happened to be at those moments, and on a pool that goes
 * days between trades every sample collapses to the same standing value — so a
 * median of five is one observation counted five times, with none of the outlier
 * resistance a median is chosen for. The events carry each swap's exact
 * post-swap price, which is what makes a genuine time-weighted average possible.
 *
 * The range is split into `chunkBlocks` requests issued together, because
 * providers cap the span of a single `eth_getLogs` (commonly at 10k blocks).
 * Result volume is not a concern here — this pool trades a couple of times a
 * day.
 *
 * A swap whose price converts to zero is dropped rather than averaged in: that
 * requires a sqrtPrice below ~7.9e13, far outside anything the configured bounds
 * would accept.
 */
export const fetchSwapPrices = async (
  fromBlock: bigint,
  toBlock: bigint,
  chunkBlocks: number,
): Promise<PricePoint[]> => {
  if (toBlock < fromBlock) {
    return []
  }
  const span = BigInt(Math.max(1, Math.floor(chunkBlocks)))
  const ranges: { from: bigint; to: bigint }[] = []
  for (let start = fromBlock; start <= toBlock; start += span) {
    const end = start + span - 1n
    ranges.push({ from: start, to: end > toBlock ? toBlock : end })
  }

  const publicClient = getClient()
  const chunks = await Promise.all(
    ranges.map(({ from, to }) =>
      publicClient.getLogs({
        address: POOL_MANAGER_ADDRESS,
        event: SWAP_EVENT,
        args: { id: POOL_ID },
        fromBlock: from,
        toBlock: to,
        // Drop any log that does not decode against the full event signature,
        // rather than surfacing it with half-undefined args.
        strict: true,
      }),
    ),
  )

  return chunks
    .flat()
    .filter((log) => log.args.sqrtPriceX96 > 0n)
    .map((log) => ({
      blockNumber: log.blockNumber,
      usdPerAi3: sqrtPriceX96ToUsdPerAi3(log.args.sqrtPriceX96),
    }))
}
