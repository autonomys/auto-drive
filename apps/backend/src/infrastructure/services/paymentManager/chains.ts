import { getAddress } from 'viem'
import {
  PaymentMethod,
  intentPaymentReceivedAbi,
  intentTokenPaymentReceivedAbi,
} from '@auto-drive/models'
import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import { createPaymentWatcher, PaymentChain } from './watcher.js'
import { usdcChainGuard } from './usdcChainGuard.js'

const logger = createLogger('PaymentManager:chains')

// Auto EVM produces blocks every ~6s, so 6 confirmations is ~36s. viem's own
// 180s default already covers inclusion plus that, and it is the behaviour that
// has been in production, so it is kept exactly.
const AUTO_EVM_RECEIPT_TIMEOUT_MS = 180_000

// Ethereum blocks are ~12s, so 6 confirmations is ~72s of the wait on its own.
// A transaction that takes two minutes to be included — a low priority fee, a
// busy hour — would blow through viem's 180s default, and the watch task would
// retry and eventually raise a payment-failed alert for a payment that was
// perfectly fine. 10 minutes covers a slow inclusion plus the confirmations.
const ETHEREUM_RECEIPT_TIMEOUT_MS = 600_000

// AutoDriveUSDCReceiver exposes its configured ERC20 as `token()` — the public
// getter of an immutable. Read at startup to check this deployment's
// USDC_TOKEN_ADDRESS against the contract that is actually deployed.
const receiverTokenAbi = [
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const

/**
 * Native AI3 on Auto EVM — the original PayWithAI3 flow.
 *
 * `receipt.from` is the payer here, and it has to be: IntentPaymentReceived
 * carries only the intent id and the amount, because a native transfer cannot be
 * relayed without the relayer becoming the sender of record anyway.
 */
export const ai3Chain: PaymentChain<
  typeof intentPaymentReceivedAbi,
  'IntentPaymentReceived'
> = {
  name: 'ai3',
  paymentMethod: PaymentMethod.AI3_NATIVE,
  rpcUrl: config.paymentManager.url,
  contractAddress: config.paymentManager.contractAddress,
  confirmations: config.paymentManager.confirmations,
  receiptTimeoutMs: AUTO_EVM_RECEIPT_TIMEOUT_MS,
  abi: intentPaymentReceivedAbi,
  eventName: 'IntentPaymentReceived',
  toPayment: (log, receipt) => ({
    kind: 'payment',
    payment: {
      intentId: log.args.intentId,
      paymentAmount: log.args.paymentAmount,
      // receipt.from is the EVM wallet address that submitted the tx.
      // Stored so admins can identify the payer and process refunds.
      fromAddress: receipt.from,
    },
  }),
}

export const ai3PaymentWatcher = createPaymentWatcher(ai3Chain)

/**
 * USDC (ERC20) on Ethereum — the deferred-conversion flow.
 *
 * Takes its addresses as arguments rather than reading config, so a test can
 * build this chain without an Ethereum deployment behind it.
 *
 * Both addresses go through `getAddress` once, here, which is what makes the
 * token comparison below checksum-insensitive: an operator pasting a lowercase
 * address out of a block explorer must not turn every payment into an ignored
 * event.
 */
export const createUsdcChain = (
  rpcUrl: string,
  receiverAddress: string,
  tokenAddress: string,
): PaymentChain<
  typeof intentTokenPaymentReceivedAbi,
  'IntentTokenPaymentReceived'
> => {
  const expectedToken = getAddress(tokenAddress)
  const contractAddress = getAddress(receiverAddress)

  return {
    name: 'usdc',
    paymentMethod: PaymentMethod.USDC_ETH,
    rpcUrl,
    contractAddress,
    confirmations: config.ethereum.confirmations,
    receiptTimeoutMs: ETHEREUM_RECEIPT_TIMEOUT_MS,
    abi: intentTokenPaymentReceivedAbi,
    eventName: 'IntentTokenPaymentReceived',
    // The receiver's token is immutable and these logs are already filtered to
    // the receiver, so a mismatch here is not a user paying in the wrong token —
    // it is USDC_TOKEN_ADDRESS disagreeing with the deployed contract, which
    // makes EVERY payment unreadable rather than one. verifyConfiguration below
    // is what turns that from a slow discovery into a startup alert.
    //
    // Refused rather than credited because every number downstream assumes 6
    // decimals: an 18-decimal token would read as a payment 10^12 times the one
    // that arrived, against a quote denominated in dollars.
    toPayment: (log) => {
      if (getAddress(log.args.token) !== expectedToken) {
        return {
          kind: 'ignored',
          reason:
            `payment in ${log.args.token}, but this receiver is configured ` +
            `for ${expectedToken}`,
          refused: {
            intentId: log.args.intentId,
            fromAddress: log.args.payer,
          },
        }
      }

      return {
        kind: 'payment',
        payment: {
          intentId: log.args.intentId,
          // Token base units, kept off paymentAmount: that column is
          // denominated in shannons, and USDC in it would make every AI3-shaped
          // read of the row silently wrong.
          tokenAmount: log.args.amount,
          // The event's payer, NOT receipt.from. An ERC20 payment can be
          // relayed — a paymaster, a smart account, a batching contract — and in
          // every one of those cases receipt.from is the relayer. Refunding it
          // would send the money to someone who never sent any.
          fromAddress: log.args.payer,
        },
      }
    },
    // ETH_CHAIN_ID against the endpoint. Set here and not on ai3Chain: this is
    // the id the purchase flow is TOLD to switch a wallet to, so a wrong value
    // costs a buyer their payment. Auto EVM has a configured id too
    // (EVM_CHAIN_ID) and the same check would fit it, but turning it on would be
    // a new production alert on a path this change is not otherwise touching.
    //
    // Delegated to usdcChainGuard rather than read here, because the same
    // verdict has to stop `getAvailability` and `getPaymentTarget` — including
    // in `start:fe:api`, which serves the target and runs no watcher at all.
    verifyChain: async () =>
      (await usdcChainGuard.verify()).state !== 'mismatch',
    verifyConfiguration: async (client) => {
      const deployedToken = await client.readContract({
        address: contractAddress,
        abi: receiverTokenAbi,
        functionName: 'token',
      })

      if (getAddress(deployedToken) !== expectedToken) {
        return {
          ok: false,
          problem:
            `USDC_TOKEN_ADDRESS is ${expectedToken}, but the receiver at ` +
            `${contractAddress} accepts ${getAddress(deployedToken)}. Every ` +
            'payment to it will be refused and filed rather than credited.',
        }
      }

      return { ok: true }
    },
  }
}

const buildUsdcWatcher = (
  rpcUrl: string,
  receiverAddress: string,
  tokenAddress: string,
) =>
  createPaymentWatcher(createUsdcChain(rpcUrl, receiverAddress, tokenAddress))

// Typed off the builder rather than off createPaymentWatcher: that generic
// resolves to its own constraint (any Abi, any event name), which no concrete
// watcher satisfies.
let usdcWatcher: ReturnType<typeof buildUsdcWatcher> | null = null

/**
 * The Ethereum watcher, when this deployment is configured for one.
 *
 * ETH_USDC_RECEIVER_ADDRESS is the switch. It is the one variable that means
 * "this deployment accepts USDC" and nothing else: ETH_CHAIN_ENDPOINT has other
 * readers (the treasury balance check in #811, and the price oracle before #807
 * moved to a subgraph), so a deployment can hold an Ethereum endpoint for
 * reasons that have nothing to do with payments, and a leftover endpoint must
 * not fail a boot. createIntent refuses to quote USDC on the same key, so that
 * quoting a purchase and watching for its payment cannot disagree.
 *
 * With the receiver set, an incomplete configuration throws rather than
 * returning a watcher that cannot see the contract. The two failures are
 * indistinguishable from outside: "no USDC payments are arriving" is what a
 * missing endpoint looks like, and also what a working watcher on a quiet day
 * looks like. The one thing that must never happen quietly is a quoted USDC
 * intent nobody is watching for.
 *
 * Resolved lazily rather than at module load, and that matters more than it
 * looks: `eventRouter/index.ts` imports the frontend processor, which reaches
 * this file, so the download server and the publish worker evaluate this module
 * too. Throwing at import time would put those processes into a crash loop over
 * a payments variable they never read. Resolution happens instead in
 * `paymentManager.start()` — the process that owns payments, where a bad
 * configuration should be fatal and loud — and in the USDC branch of
 * `watchTransaction`, where it lands on the task's retry path.
 *
 * Keyed on configuration, not on the payWithUsdc feature flag. Turning quoting
 * off must not turn observation off: intents quoted while the flag was open stay
 * payable for the rest of their lock, and a payment already in flight has to be
 * credited whatever the flags now say (#748, #811).
 */
export const getUsdcPaymentWatcher = () => {
  if (usdcWatcher) return usdcWatcher

  const { rpcUrl, usdcReceiverAddress, usdcTokenAddress } = config.ethereum

  if (!usdcReceiverAddress) {
    return null
  }

  const missing = (
    [
      ['ETH_CHAIN_ENDPOINT', rpcUrl],
      ['USDC_TOKEN_ADDRESS', usdcTokenAddress],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(
      'Incomplete Ethereum USDC configuration: ETH_USDC_RECEIVER_ADDRESS is ' +
        `set but ${missing.join(' and ')} ` +
        `${missing.length > 1 ? 'are' : 'is'} not. Set all three to watch for ` +
        'USDC payments, or unset ETH_USDC_RECEIVER_ADDRESS to run AI3 payments ' +
        'only.',
    )
  }

  logger.info('Ethereum USDC payment watcher configured', {
    receiverAddress: usdcReceiverAddress,
    tokenAddress: usdcTokenAddress,
    // The id the purchase flow will be told to switch wallets to. Logged beside
    // the addresses because it is the one value here with no default worth
    // trusting silently — verifyConfiguration checks it against the endpoint.
    chainId: config.ethereum.chainId,
  })

  // Memoised only on success. A configuration that throws is re-derived on
  // every call, which costs nothing and keeps the error attached to whoever
  // asked rather than to whoever asked first.
  usdcWatcher = buildUsdcWatcher(
    rpcUrl!,
    usdcReceiverAddress,
    usdcTokenAddress!,
  )
  return usdcWatcher
}

// Tests only: drops the memoised watcher so a case can resolve it again under
// different configuration.
export const _resetUsdcPaymentWatcher = () => {
  usdcWatcher = null
}
