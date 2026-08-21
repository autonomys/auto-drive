import { getAddress } from 'viem'
import {
  PaymentMethod,
  intentPaymentReceivedAbi,
  intentTokenPaymentReceivedAbi,
} from '@auto-drive/models'
import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import { createPaymentWatcher, PaymentChain } from './watcher.js'

const logger = createLogger('PaymentManager:chains')

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

  return {
    name: 'usdc',
    paymentMethod: PaymentMethod.USDC_ETH,
    rpcUrl,
    contractAddress: getAddress(receiverAddress),
    confirmations: config.ethereum.confirmations,
    abi: intentTokenPaymentReceivedAbi,
    eventName: 'IntentTokenPaymentReceived',
    toPayment: (log) => {
      // The receiver only ever moves the ERC20 it was constructed with, so a
      // mismatch is not a user paying in the wrong token — it is this
      // deployment's USDC_TOKEN_ADDRESS disagreeing with the deployed contract.
      // Refused rather than credited because every downstream number assumes 6
      // decimals: an 18-decimal token would read as a payment 10^12 times the
      // one that arrived, and the quote it settles was denominated in dollars.
      if (getAddress(log.args.token) !== expectedToken) {
        return {
          kind: 'ignored',
          reason:
            `payment in ${log.args.token}, but this receiver is configured ` +
            `for ${expectedToken}`,
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
  }
}

/**
 * The Ethereum watcher, when this deployment is configured for one.
 *
 * ETH_USDC_RECEIVER_ADDRESS is the switch, and the other two are then required.
 * It is the one variable that means "this deployment accepts USDC" and nothing
 * else: ETH_CHAIN_ENDPOINT has other readers (the treasury balance check in
 * #811, and the price oracle before #807 moved to a subgraph), so a deployment
 * can hold an Ethereum endpoint for reasons that have nothing to do with
 * payments — and a leftover endpoint must not fail a boot.
 *
 * With the receiver set, an incomplete configuration throws at startup rather
 * than starting a watcher that cannot see the contract. The two failures are
 * indistinguishable from the outside: "no USDC payments are arriving" is what a
 * missing endpoint looks like, and also what a working watcher on a quiet day
 * looks like. The one thing that must never happen quietly is a quoted USDC
 * intent nobody is watching for.
 *
 * Keyed on configuration, not on the payWithUsdc feature flag. Turning quoting
 * off must not turn observation off: intents quoted while the flag was open stay
 * payable for the rest of their lock, and a payment already in flight has to be
 * credited whatever the flags now say (#748, #811).
 */
export const usdcPaymentWatcher = (() => {
  const { rpcUrl, usdcReceiverAddress, usdcTokenAddress } = config.ethereum

  if (!usdcReceiverAddress) {
    logger.info(
      'Ethereum USDC payment watcher not configured — AI3 payments only',
    )
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
    chainId: config.ethereum.chainId,
    receiverAddress: usdcReceiverAddress,
    tokenAddress: usdcTokenAddress,
  })

  return createPaymentWatcher(
    createUsdcChain(rpcUrl!, usdcReceiverAddress, usdcTokenAddress!),
  )
})()
