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
  // Optional pre-check: is this endpoint the chain this deployment SERVES?
  //
  // Returns false only when that has been verified wrong, in which case nothing
  // below is worth running — on the wrong chain `contractAddress` holds either
  // nothing or something unrelated, so a verdict from it is evidence of nothing.
  // A check that could not RUN returns true, for the same reason the code read
  // below tolerates its own failure: an RPC down at boot says nothing.
  //
  // A hook rather than an expected-id field because the decision has a consumer
  // outside this watcher — a mismatch also has to stop the deployment SELLING
  // (see usdcChainGuard), and one verdict with two readers beats two checks that
  // can disagree.
  verifyChain?: () => Promise<boolean>
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

  // Transactions currently being watched, so three callers cannot process one
  // transaction at the same time.
  //
  // Three paths reach watchTransaction independently: the contract-event
  // subscription, the watch-intent-tx task, and the startup sweep. Two of them
  // arriving together — a redelivered task landing while the sweep re-watches
  // the same row, which is the normal shape of a worker restart — means two
  // markIntentAsConfirmed calls for the SAME payment, with the same hash and the
  // same log index. One wins the conditional PENDING -> CONFIRMED update and the
  // other is filed as ALREADY_SETTLED: a second transfer reported to an admin
  // that never happened, in a queue whose entries mean "reconcile this money".
  //
  // Collapsing them here is the cheap half of the fix. It cannot cover two
  // processes, but there is exactly one payment worker, and the sequential case
  // is already correct — the second call sees a settled intent with a matching
  // hash, amount and asset, and is recognised as re-delivery.
  //
  // Distinct payments are unaffected: this is keyed by transaction, and two
  // payments inside one transaction are two logs of a single call, which still
  // run concurrently below.
  //
  // Keyed on the LOWER-CASED hash, because the three feeders do not agree on
  // case. viem hands the subscription a lowercase transactionHash; the task and
  // the sweep carry whatever was written to intents.tx_hash. The controller now
  // normalises what it accepts, so new rows agree — but rows already stored, and
  // any caller that reaches this function another way, still do not, and one
  // transaction under two spellings defeats the whole point of this map.
  const inFlight = new Map<string, Promise<void>>()

  // Receives a tx hash and watches for the deposit event
  // Marks the intent as confirmed if the deposit event is found
  const watchTransaction = async (txHash: string) => {
    if (!txHash.startsWith('0x')) {
      throw new Error('Invalid tx hash')
    }

    // The key is normalised; the hash itself is passed on untouched. Rewriting
    // it here would be the wrong fix: markIntentAsConfirmed compares the incoming
    // hash against intents.tx_hash to recognise a replay, so handing it a
    // lower-cased hash for a row stored mixed-case would turn every recovery
    // sweep of that row into a filed second payment. That comparison is made
    // case-insensitive at its own site instead.
    const key = txHash.toLowerCase()

    const already = inFlight.get(key)
    if (already) {
      logger.info('Already watching this transaction — joining it', { txHash })
      return already
    }

    const settling = settleTransaction(txHash).finally(() => {
      inFlight.delete(key)
    })
    inFlight.set(key, settling)
    return settling
  }

  const settleTransaction = async (txHash: string) => {
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

    // Concurrently, and that is load-bearing rather than incidental.
    //
    // Both receivers are callable from a contract, so one transaction can carry
    // two payments for the same intent. markIntentAsConfirmed tells those apart
    // by which call wins a conditional PENDING -> CONFIRMED update, and files the
    // loser as ALREADY_SETTLED. That discriminator only works while both calls
    // are still looking at a PENDING row: serialise them and the second arrives
    // after the first has settled the intent, where the idempotency guard sees a
    // matching hash, a matching amount and a matching asset, concludes
    // re-delivery, and absorbs a real second transfer without a trace.
    //
    // So the ordering here is not an optimisation to be tidied into a loop. Two
    // payments arriving together must reach the transition together.
    const results = await Promise.all(
      logs.map(async (log) => {
        const read = chain.toPayment(log, receipt)

        if (read.kind === 'ignored') {
          // Loud, because the only way to get here is a configuration or
          // deployment mismatch — and filed, because the transfer happened and a
          // log line is not something an admin can query. The intent stays
          // PENDING and expires on its own schedule.
          logger.error('Ignoring an unrecognised payment event', {
            txHash,
            logIndex: log.logIndex,
            reason: read.reason,
          })
          await IntentsUseCases.recordRefusedPayment({
            intentId: read.refused.intentId,
            reason: IntentMispaymentReason.UNRECOGNISED_TOKEN,
            // No expectedPaymentMethod. The column means what the named intent
            // was denominated in, and this path has not looked the intent up —
            // filling it with the chain's own asset would state as fact
            // something nobody checked. The reason says what happened; the hash
            // and the payer say where to look.
            fromAddress: read.refused.fromAddress,
            txHash,
            logIndex: log.logIndex,
          })
          return null
        }

        return IntentsUseCases.markIntentAsConfirmed({
          ...read.payment,
          // Passed for the refusal paths: a payment we decline to attach is
          // recorded in intent_mispayments, and the hash is the only field that
          // finds it again on a block explorer.
          txHash,
          // Which payment inside this transaction it was. The hash alone cannot
          // separate two of them, so a filed refusal would collapse into the
          // first and the queue would report one payment when two arrived.
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
    if (!chain.verifyChain && !chain.verifyConfiguration) return

    // Is this endpoint the chain we think it is?
    //
    // First, because everything below reads state at an address, and on the
    // wrong chain that address holds either nothing or something unrelated — so
    // a passing token check there would be evidence of nothing at all. The hook
    // owns the read, the escalation and the refusal that follows from it.
    if (chain.verifyChain && !(await chain.verifyChain())) return

    if (!chain.verifyConfiguration) return

    // Is there a contract there at all?
    //
    // Asked first because the check below reads a function off the receiver, and
    // a receiver address pointing at an EOA, at the token contract, or at nothing
    // makes that read THROW — which is indistinguishable, to the catch below,
    // from the RPC being down. So the single most likely misconfiguration would
    // be the one reported as "could not verify" and never escalated.
    //
    // Empty code is not a transient condition, so it is escalated like any other
    // mismatch. A failure to READ the code is transient and falls through to the
    // same tolerant path as everything else.
    try {
      const code = await watcher._viemClient.getCode({
        address: chain.contractAddress,
      })
      if (!code || code === '0x') {
        logger.error(
          'No contract is deployed at the configured payment address — payments will NOT be observed',
          { chain: chain.name, contractAddress: chain.contractAddress },
        )
        await slackNotifier.send({
          title: `:rotating_light: ${chain.name} payment watcher is misconfigured — payments will not be observed`,
          details:
            `No contract code at ${chain.contractAddress}. The watcher is ` +
            'subscribed to an address that cannot emit payment events.',
        })
        return
      }
    } catch (error) {
      logger.warn(
        'Could not read the payment contract code — continuing to the token check',
        { chain: chain.name, error },
      )
    }

    let verdict: Awaited<
      ReturnType<NonNullable<typeof chain.verifyConfiguration>>
    >
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
