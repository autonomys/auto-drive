import {
  Abi,
  ContractEventName,
  createPublicClient,
  http,
  Log,
  ParseEventLogsParameters,
  ParseEventLogsReturnType,
  parseEventLogs as viemParseEventLogs,
} from 'viem'
import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import { intentPaymentReceivedAbi } from '@auto-drive/models'
import { IntentsUseCases } from '../../../core/users/intents.js'
import { safeCallback } from '../../../shared/utils/safe.js'

const logger = createLogger('PaymentManager')

const viemClient = createPublicClient({
  transport: http(config.paymentManager.url),
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
  const receipt = await viemClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
    confirmations: config.paymentManager.confirmations,
  })

  // Filter logs to only include the deposit event
  const logs = paymentManager
    ._parseEventLogs({
      abi: intentPaymentReceivedAbi,
      eventName: intentPaymentReceivedAbi[0].name,
      logs: receipt.logs,
    })
    // Filter logs to only include logs from the payment manager contract
    .filter(
      (log) =>
        log.address.toLowerCase() ===
        config.paymentManager.contractAddress.toLowerCase(),
    )

  logger.info('Transaction logs', {
    logs,
  })

  const results = await Promise.all(
    logs.map((log) => {
      return IntentsUseCases.markIntentAsConfirmed({
        intentId: log.args.intentId,
        paymentAmount: log.args.paymentAmount,
        // receipt.from is the EVM wallet address that submitted the tx.
        // Stored so admins can identify the payer and process refunds.
        fromAddress: receipt.from,
        // Passed for the refusal paths: a payment we decline to attach is
        // recorded in intent_mispayments, and the hash is the only field that
        // finds it again on a block explorer.
        txHash,
        // One transaction can carry two payments for the same intent — the
        // receivers are callable from a contract, and this maps over every
        // matching log. The hash alone would make the two indistinguishable, so
        // recording the second would collapse into the first and the queue would
        // report one payment when two arrived.
        logIndex: log.logIndex,
      })
    }),
  )

  results.forEach((result) => {
    if (result.isErr()) {
      logger.error('Error marking intent as confirmed', {
        error: result.error,
      })
    }
  })
}

const _checkConfirmedIntents = async () => {
  logger.info('Checking confirmed intents')
  const intents = await IntentsUseCases.getConfirmedIntents()
  logger.info('Found confirmed intents', {
    intents: intents.map((intent) => intent.id),
  })
  for (const intent of intents) {
    // Per-intent, because `result.isErr()` only catches what onConfirmedIntent
    // RETURNS. A thrown exception escapes this loop entirely and is swallowed by
    // the safeCallback wrapping the interval, so one bad row stops every intent
    // behind it in the batch from being credited — and since the batch is
    // re-fetched each tick, it stops them forever, from users who paid
    // correctly, with nothing terminal written anywhere to show why.
    //
    // getIntentCredits dividing by a zero shannonsPerByte is the known way in
    // (guarded there too), but the point of this catch is the ones that are not
    // known: an intent that cannot be processed must cost its own turn, never
    // the queue's.
    try {
      const result = await IntentsUseCases.onConfirmedIntent(intent.id)

      if (result.isErr()) {
        logger.error('Error on confirmed intent', {
          intentId: intent.id,
          error: result.error,
        })
      } else {
        logger.info('Marked intent as confirmed', {
          intentId: intent.id,
        })
      }
    } catch (error) {
      logger.error('Unhandled error on confirmed intent — skipping it', {
        intentId: intent.id,
        error,
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
        await paymentManager.watchTransaction(transactionHash)
      }
    }),
  )
})

const parseEventLogs = <
  abi extends Abi | readonly unknown[],
  strict extends boolean | undefined = true,
  eventName extends
    | ContractEventName<abi>
    | ContractEventName<abi>[]
    | undefined = undefined,
>(
  parameters: ParseEventLogsParameters<abi, eventName, strict>,
): ParseEventLogsReturnType<abi, eventName, strict> => {
  return viemParseEventLogs<abi, strict, eventName>(parameters)
}

let checkInterval: NodeJS.Timeout | null = null
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
const _recoverOrphanedTransactions = async () => {
  const pending = await IntentsUseCases.getPendingWithTxHash()
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
        await paymentManager.watchTransaction(intent.txHash)
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
  logger.info('Starting payment manager')

  // Run the recovery sweep asynchronously so it does not block startup.
  // Errors inside the sweep are caught per-intent and logged individually.
  safeCallback(paymentManager._recoverOrphanedTransactions)()

  checkInterval = setInterval(
    safeCallback(paymentManager._checkConfirmedIntents),
    config.paymentManager.checkInterval,
  )
  unwatchContractEvent = viemClient.watchContractEvent({
    abi: intentPaymentReceivedAbi,
    address: config.paymentManager.contractAddress,
    eventName: intentPaymentReceivedAbi[0].name,
    onLogs: paymentManager._onLogs,
  })
}

const stop = () => {
  logger.info('Stopping payment manager')
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
  if (unwatchContractEvent) {
    unwatchContractEvent()
    unwatchContractEvent = null
  }
}

export const paymentManager = {
  watchTransaction,
  start,
  stop,
  _onLogs: onLogs,
  _checkConfirmedIntents: _checkConfirmedIntents,
  _recoverOrphanedTransactions: _recoverOrphanedTransactions,
  _viemClient: viemClient,
  _parseEventLogs: parseEventLogs,
}
