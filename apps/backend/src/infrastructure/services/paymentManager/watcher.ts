import {
  Abi,
  ContractEventName,
  createPublicClient,
  http,
  Log,
  ParseEventLogsParameters,
  ParseEventLogsReturnType,
  TransactionReceipt,
  parseEventLogs as viemParseEventLogs,
} from 'viem'
import { PaymentMethod } from '@auto-drive/models'
import { createLogger } from '../../drivers/logger.js'
import { IntentsUseCases } from '../../../core/users/intents.js'
import { safeCallback } from '../../../shared/utils/safe.js'

/**
 * A payment event, read in the terms of the asset it arrived in.
 *
 * Exactly one of the two amounts is set. They are separate fields rather than
 * one amount plus a unit because that is the shape markIntentAsConfirmed
 * requires: shannons and USDC base units live in different columns, and which
 * one a confirmation supplies is what the asset-mismatch guard checks. Handing
 * it a single number and a label would move that decision here, into two places
 * instead of one.
 */
export type ParsedPayment = {
  intentId: string
  // AI3 path: shannons received on Auto EVM.
  paymentAmount?: bigint
  // USDC path: token base units received (6 decimals).
  tokenAmount?: bigint
  // The wallet to refund, when there is anything to refund.
  fromAddress?: string
}

/**
 * Reading one log either yields a payment or it does not.
 *
 * `ignored` exists so a chain can refuse an event it does not recognise —
 * today, a payment in an ERC20 the receiver was not deployed against — while
 * leaving the logging to the watcher. A `null` return would say the same thing
 * without saying why, and "why" is the whole content of the log line an operator
 * needs to see.
 */
export type PaymentRead =
  | { kind: 'payment'; payment: ParsedPayment }
  | { kind: 'ignored'; reason: string }

/**
 * Everything the watcher needs to know about one chain.
 *
 * Generic over the event ABI so `toPayment` receives the log already typed by
 * the event it came from: the two receivers name their fields differently
 * (`paymentAmount` vs `amount`/`payer`) and getting that mapping wrong is a
 * silent credit-the-wrong-number bug, which is exactly the kind of thing the
 * compiler should be catching rather than a test.
 */
export type PaymentChain<
  abi extends Abi | readonly unknown[],
  eventName extends ContractEventName<abi>,
> = {
  // Log namespace and the label an operator sees. Not a chain id: the point is
  // to tell the AI3 watcher from the USDC one in a log line.
  name: string
  // Which intents this watcher owns. Orphan recovery filters on it so a tx hash
  // is only ever looked up on the chain it was submitted to — an Ethereum hash
  // asked of Auto EVM is not an error, it is a receipt that never arrives.
  paymentMethod: PaymentMethod
  rpcUrl: string
  contractAddress: `0x${string}`
  confirmations: number
  abi: abi
  eventName: eventName
  toPayment: (
    log: ParseEventLogsReturnType<abi, eventName, true>[number],
    receipt: TransactionReceipt,
  ) => PaymentRead
}

/**
 * One chain's payment watcher: event subscription, receipt confirmation, and
 * the startup sweep that re-watches transactions submitted before a restart.
 *
 * Deliberately does NOT include the confirmed-intent polling loop that grants
 * credits. That loop reads every CONFIRMED intent regardless of asset and is
 * chain-independent, so one instance per chain would mean two processes racing
 * to grant the same credits — see confirmedIntents.ts.
 */
export const createPaymentWatcher = <
  const abi extends Abi | readonly unknown[],
  eventName extends ContractEventName<abi>,
>(
  chain: PaymentChain<abi, eventName>,
) => {
  const logger = createLogger(`PaymentManager:${chain.name}`)

  const viemClient = createPublicClient({
    transport: http(chain.rpcUrl),
  })

  // Receives a tx hash and watches for the deposit event
  // Marks the intent as confirmed if the deposit event is found
  const watchTransaction = async (txHash: string) => {
    if (!txHash.startsWith('0x')) {
      throw new Error('Invalid tx hash')
    }

    logger.info('Watching transaction', {
      txHash,
    })
    const receipt = await watcher._viemClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      confirmations: chain.confirmations,
    })

    // Filter logs to only include the deposit event
    const logs = watcher
      ._parseEventLogs({
        abi: chain.abi,
        eventName: chain.eventName,
        logs: receipt.logs,
      })
      // Filter logs to only include logs from the payment manager contract
      .filter(
        (log) =>
          log.address.toLowerCase() === chain.contractAddress.toLowerCase(),
      )

    logger.info('Transaction logs', {
      logs,
    })

    const results = await Promise.all(
      logs.map(async (log) => {
        const read = chain.toPayment(log, receipt)
        if (read.kind === 'ignored') {
          // Not a failure to retry and not a mispayment we can file: an event
          // this watcher cannot read in the asset it expects names no amount it
          // could record. Loud, because the only way to get here is a
          // configuration or deployment mismatch.
          logger.error('Ignoring an unrecognised payment event', {
            txHash,
            logIndex: log.logIndex,
            reason: read.reason,
          })
          return null
        }

        return IntentsUseCases.markIntentAsConfirmed({
          ...read.payment,
          // Passed for the refusal paths: a payment we decline to attach is
          // recorded in intent_mispayments, and the hash is the only field that
          // finds it again on a block explorer.
          txHash,
          // One transaction can carry two payments for the same intent — the
          // receivers are callable from a contract, and this maps over every
          // matching log. The hash alone would make the two indistinguishable,
          // so recording the second would collapse into the first and the queue
          // would report one payment when two arrived.
          logIndex: log.logIndex,
        })
      }),
    )

    results.forEach((result) => {
      if (result?.isErr()) {
        logger.error('Error marking intent as confirmed', {
          error: result.error,
        })
      }
    })
  }

  const onLogs = safeCallback((logs: Log[]) => {
    logger.info('Deposit event', {
      logs: logs.map((log) => log.transactionHash),
    })
    logs.forEach(
      safeCallback(async (log: Log) => {
        const transactionHash = log.transactionHash as `0x${string}` | null
        if (transactionHash) {
          await watcher.watchTransaction(transactionHash)
        }
      }),
    )
  })

  const parseEventLogs = <
    parseAbi extends Abi | readonly unknown[],
    strict extends boolean | undefined = true,
    parseEventName extends
      | ContractEventName<parseAbi>
      | ContractEventName<parseAbi>[]
      | undefined = undefined,
  >(
    parameters: ParseEventLogsParameters<parseAbi, parseEventName, strict>,
  ): ParseEventLogsReturnType<parseAbi, parseEventName, strict> => {
    return viemParseEventLogs<parseAbi, strict, parseEventName>(parameters)
  }

  let unwatchContractEvent: (() => void) | null = null

  // On startup, re-watch any PENDING intents that already have a tx_hash.
  // These represent transactions submitted by users before the last service
  // restart or during an EVM RPC outage.  The cleanup job explicitly skips
  // PENDING+txHash rows (they are not abandoned — they are actively watched),
  // so without this sweep they would sit in limbo indefinitely: the user paid
  // on-chain but receives no credits.
  //
  // Re-calling watchTransaction for each orphan is safe:
  //   • waitForTransactionReceipt returns immediately for already-mined txs
  //   • markIntentAsConfirmed is idempotent — a duplicate CONFIRMED write is a
  //     no-op if the intent was already processed before the restart
  //
  // Scoped to this watcher's payment method. Sweeping every chain's rows would
  // hand each watcher hashes from the other chain, where they resolve to a
  // 180-second receipt timeout per row rather than to an error — so a USDC
  // payment would be reported as an AI3 RPC failure, and the sweep that exists
  // to rescue paid intents would spend its startup window on rows it cannot see.
  const _recoverOrphanedTransactions = async () => {
    const pending = await IntentsUseCases.getPendingWithTxHash(
      chain.paymentMethod,
    )
    if (pending.length === 0) {
      logger.info('Startup recovery: no orphaned transactions found')
      return
    }

    logger.info('Startup recovery: re-watching orphaned transactions', {
      count: pending.length,
      intentIds: pending.map((i) => i.id),
    })

    await Promise.allSettled(
      pending.map(async (intent) => {
        if (!intent.txHash) return
        try {
          await watcher.watchTransaction(intent.txHash)
          logger.info('Startup recovery: transaction recovered', {
            intentId: intent.id,
            txHash: intent.txHash,
          })
        } catch (err) {
          logger.error('Startup recovery: failed to recover transaction', {
            intentId: intent.id,
            txHash: intent.txHash,
            err,
          })
        }
      }),
    )
  }

  const start = () => {
    if (unwatchContractEvent) {
      // A second subscription would process every event twice and leak the
      // first unsubscribe, leaving a watcher that stop() cannot turn off.
      logger.warn('Payment watcher already running — ignoring start', {
        chain: chain.name,
      })
      return
    }

    logger.info('Starting payment watcher', {
      chain: chain.name,
      contractAddress: chain.contractAddress,
      confirmations: chain.confirmations,
    })

    // Run the recovery sweep asynchronously so it does not block startup.
    // Errors inside the sweep are caught per-intent and logged individually.
    safeCallback(watcher._recoverOrphanedTransactions)()

    unwatchContractEvent = watcher._viemClient.watchContractEvent({
      abi: chain.abi,
      address: chain.contractAddress,
      eventName: chain.eventName,
      onLogs: watcher._onLogs,
    })
  }

  const stop = () => {
    logger.info('Stopping payment watcher', { chain: chain.name })
    if (unwatchContractEvent) {
      unwatchContractEvent()
      unwatchContractEvent = null
    }
  }

  const watcher = {
    chain,
    watchTransaction,
    start,
    stop,
    _onLogs: onLogs,
    _recoverOrphanedTransactions,
    _viemClient: viemClient,
    _parseEventLogs: parseEventLogs,
  }

  return watcher
}

export type PaymentWatcher = ReturnType<typeof createPaymentWatcher>
