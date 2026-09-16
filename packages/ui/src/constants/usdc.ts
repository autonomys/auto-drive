// From viem, not `wagmi/chains` — which is nothing but `export * from
// 'viem/chains'`. One less runtime dependency for this package to declare, and
// the definitions are the same objects wagmi would have handed back.
import { http, Transport } from 'viem'
import { Chain, mainnet, sepolia } from 'viem/chains'

/**
 * The Ethereum chains a USDC purchase may settle on.
 *
 * Deliberately NOT keyed by `NetworkId`, unlike `evmChains`. That mapping is
 * right for AI3, where the Auto EVM chain IS the Auto Drive network. USDC has no
 * such coupling — the deployment names its chain at runtime, via
 * `GET /payments/usdc/target` (see `UsdcPaymentTarget`).
 *
 * So this is a *set of chains this client knows how to talk to*, listed in the
 * wagmi config so a wallet can be switched to whichever one the backend names.
 * Only one is ever the live target.
 */
const TESTNET_CHAINS: readonly Chain[] = [sepolia]

/**
 * Are the Ethereum testnets on offer in this build?
 *
 * Opt-in, via NEXT_PUBLIC_USDC_TESTNET_CHAINS=true. Every chain listed below is
 * registered with wagmi for EVERY user of this deployment, and a wallet's chain
 * list is not nothing: a production build that advertises Sepolia alongside
 * Ethereum invites a buyer to wonder which one they are being asked to pay on.
 *
 * #752's Sepolia run sets it. A mainnet deployment does not, and then the only
 * Ethereum chain this build knows is the one it sells on — so a target naming
 * any other reads as `isUnsupported` rather than silently switching a wallet to
 * a testnet.
 */
const testnetsEnabled = process.env.NEXT_PUBLIC_USDC_TESTNET_CHAINS === 'true'

export const usdcPaymentChains: readonly [Chain, ...Chain[]] = testnetsEnabled
  ? [mainnet, ...TESTNET_CHAINS]
  : [mainnet]

/**
 * The chain the backend named, if this client knows it.
 *
 * `undefined` for an unrecognised id, which the purchase flow treats as "cannot
 * pay in USDC" rather than guessing. A wallet cannot be switched to a chain
 * wagmi was never configured with, and inventing a definition here — a name, a
 * currency, an RPC URL — for a chain nobody listed is how a payment ends up on
 * something that only resembles the intended network.
 */
export const findUsdcPaymentChain = (chainId: number): Chain | undefined =>
  usdcPaymentChains.find((chain) => chain.id === chainId)

/**
 * Transports for the chains above, preferring a configured endpoint.
 *
 * viem's built-in defaults for mainnet and Sepolia are shared public RPCs, and
 * this flow reads through them before it can do anything useful: the buyer's USDC
 * balance, and the allowance held by the receiver. A rate-limited read there does
 * not degrade gracefully — it surfaces as a failed purchase for a wallet that was
 * perfectly funded.
 *
 * `http()` with no argument falls back to the chain's own default, so an
 * unconfigured deployment behaves exactly as it would without this.
 *
 * Keyed to `usdcPaymentChains`, so a transport is never declared for a chain
 * wagmi was not given — the two lists disagreeing is a config wagmi rejects.
 */
export const usdcPaymentTransports: Record<number, Transport> =
  Object.fromEntries(
    usdcPaymentChains.map((chain) => [
      chain.id,
      http(
        (chain.id === sepolia.id
          ? process.env.NEXT_PUBLIC_ETH_SEPOLIA_RPC_URL
          : process.env.NEXT_PUBLIC_ETH_RPC_URL) || undefined,
      ),
    ]),
  )

/**
 * `approve` and `allowance` on the ERC20 being paid with.
 *
 * Only the two entries the purchase flow calls. A full ERC20 ABI would carry
 * `transfer` and `transferFrom` into a bundle that must never send either: the
 * receiver contract pulls the tokens itself, and a UI that can move a user's
 * USDC directly is a strictly larger thing to review.
 *
 * `decimals` is deliberately absent too — the deployment reports what it accepts
 * (`UsdcPaymentTarget.tokenDecimals`), and reading it from the token would let a
 * display disagree with the backend that does the crediting.
 */
export const erc20ApprovalAbi = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/**
 * `payIntentWithToken` on AutoDriveUSDCReceiver.
 *
 * Separate from `paymentReceiverAbi` (the native AI3 receiver) because they are
 * different contracts on different chains, and the shared name would invite a
 * call to the wrong one. Only the paying entry point is here; the owner-only
 * functions (`sweep`, `pause`) have no caller in this app.
 */
export const usdcReceiverAbi = [
  {
    type: 'function',
    name: 'payIntentWithToken',
    inputs: [
      { name: 'intentId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const
