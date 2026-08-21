import {
  Abi,
  ContractEventName,
  createPublicClient,
  http,
  Log,
  ParseEventLogsParameters,
  ParseEventLogsReturnType,
  PublicClient,
  TransactionReceipt,
  parseEventLogs as viemParseEventLogs,
} from 'viem'
import { IntentMispaymentReason, PaymentMethod } from '@auto-drive/models'
import { createLogger } from '../../drivers/logger.js'
import { IntentsUseCases } from '../../../core/users/intents.js'
import { safeCallback } from '../../../shared/utils/safe.js'
import { slackNotifier } from '../slack/index.js'

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
 * `ignored` carries the reason so the watcher can log it, and `refused` so the
 * transfer can still be filed for admin review. It deliberately does not carry
 * an amount: the only way to reach this branch is an event whose asset we cannot
 * name, and writing an unknown token's base units into a column documented as
 * 6-decimal USDC would make the record worse than the absence of one. The hash,
 * the log index and the payer are what find the money again.
 */
export type PaymentRead =
  | { kind: 'payment'; payment: ParsedPayment }
  | {
      kind: 'ignored'
      reason: string
      refused: { intentId: string; fromAddress?: string }
    }

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
  // How long to wait for a receipt before giving up on one attempt. Sized per
  // chain because it has to cover inclusion plus `confirmations` blocks: on
  // Ethereum, viem's 180s default is roughly the confirmation wait alone, so a
  // transaction that takes two minutes to be mined would time out, retry, and
  // eventually raise a payment-failed alert for a payment that was fine.
  receiptTimeoutMs: number
  abi: abi
  eventName: eventName
  toPayment: (
    log: ParseEventLogsReturnType<abi, eventName, true>[number],
    receipt: TransactionReceipt,
  ) => PaymentRead
  // Optional one-time check that this deployment's configuration agrees with
  // what is actually deployed at `contractAddress`. Run at startup, off the
  // critical path; see `start()` for why a failure to run it is not the same as
  // a failure of it.
  verifyConfiguration?: (
    client: PublicClient,
  ) => Promise<{ ok: true } | { ok: false; problem: string }>
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
      timeout: chain.receiptTimeoutMs,
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

    // Sequentially, one payment at a time. Both receivers are callable from a
    // contract, so one transaction can carry two payments for the same intent —
    // and markIntentAsConfirmed is a read-then-write on the intent's status.
    // Run concurrently, both calls read PENDING, both take the settle path, and
    // the second write overwrites the first's amount with neither recorded as a
    // second payment. The whole point of threading logIndex is that both halves
    // get filed; that only holds if the first one has landed before the second
    // is read.
    for (const log of logs) {
      const read = chain.toPayment(log, receipt)

      if (read.kind === 'ignored') {
        // Loud, because the only way to get here is a configuration or
        // deployment mismatch — and filed, because the transfer happened and a
        // log line is not something an admin can query. The intent stays PENDING
        // and expires on its own schedule.
        logger.error('Ignoring an unrecognised payment event', {
          txHash,
          logIndex: log.logIndex,
          reason: read.reason,
        })
        await IntentsUseCases.recordRefusedPayment({
          intentId: read.refused.intentId,
          reason: IntentMispaymentReason.UNRECOGNISED_TOKEN,
          expectedPaymentMethod: chain.paymentMethod,
          fromAddress: read.refused.fromAddress,
          txHash,
          logIndex: log.logIndex,
        })
        continue
      }

      const result = await IntentsUseCases.markIntentAsConfirmed({
        ...read.payment,
        // Passed for the refusal paths: a payment we decline to attach is
        // recorded in intent_mispayments, and the hash is the only field that
        // finds it again on a block explorer.
        txHash,
        // One transaction can carry two payments for the same intent. The hash
        // alone would make the two indistinguishable, so recording the second
        // would collapse into the first and the queue would report one payment
        // when two arrived.
        logIndex: log.logIndex,
      })

      if (result.isErr()) {
        logger.error('Error marking intent as confirmed', {
          error: result.error,
        })
      }
    }
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
  // receipt timeout per row rather than to an error — so a USDC payment would be
  // reported as an AI3 RPC failure, and the sweep that exists to rescue paid
  // intents would spend its startup window on rows it cannot see.
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

  // Ask the chain whether this deployment is configured for the contract that
  // is actually deployed.
  //
  // Separated from `start()` because the two failures are not the same: a check
  // that CANNOT RUN (RPC down at boot) says nothing and must not stop a watcher
  // from starting, while a check that RUNS AND FAILS means every payment this
  // watcher sees will be discarded. Only the second is escalated.
  const _verifyConfiguration = async () => {
    if (!chain.verifyConfiguration) return

    let verdict: Awaited<ReturnType<NonNullable<typeof chain.verifyConfiguration>>>
    try {
      verdict = await chain.verifyConfiguration(
        watcher._viemClient as PublicClient,
      )
    } catch (error) {
      logger.warn(
        'Could not verify the payment contract configuration — continuing',
        { chain: chain.name, error },
      )
      return
    }

    if (!verdict.ok) {
      // Escalated rather than logged, and not turned into a shutdown: stopping
      // would swap a stream of filed refusals for silence, and the watcher is
      // still the only thing recording that money arrived at all.
      logger.error(
        'Payment contract configuration does not match what is deployed — payments will NOT be credited',
        { chain: chain.name, problem: verdict.problem },
      )
      await slackNotifier.send({
        title: `:rotating_light: ${chain.name} payment watcher is misconfigured — payments will not be credited`,
        details: `contract: ${chain.contractAddress}\n${verdict.problem}`,
      })
    }
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

    // Both run asynchronously so they do not block startup. Errors inside the
    // sweep are caught per-intent and logged individually.
    safeCallback(watcher._verifyConfiguration)()
    safeCallback(watcher._recoverOrphanedTransactions)()

    unwatchContractEvent = watcher._viemClient.watchContractEvent({
      abi: chain.abi,
      address: chain.contractAddress,
      eventName: chain.eventName,
      onLogs: watcher._onLogs,
      // viem swallows poll failures into this callback, so without one a bad
      // endpoint, an expired filter or a rate-limited provider yields zero logs
      // and zero log lines — indefinitely, and indistinguishable from a chain
      // nobody is paying on. The primary observation channel for real money must
      // not be able to fail quietly.
      onError: (error) => {
        logger.error('Payment event subscription error', {
          chain: chain.name,
          error,
        })
      },
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
    _verifyConfiguration,
    _viemClient: viemClient,
    _parseEventLogs: parseEventLogs,
  }

  return watcher
}
