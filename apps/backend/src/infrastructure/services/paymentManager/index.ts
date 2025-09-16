import { createPublicClient, http, parseEventLogs } from 'viem'
import { config } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import { depositEventAbi } from './event-abi.js'
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
  const logs = parseEventLogs({
    abi: depositEventAbi,
    eventName: depositEventAbi[0].name,
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
        depositAmount: log.args.depositAmount,
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

const checkConfirmedIntents = async () => {
  logger.info('Checking confirmed intents')
  const intents = await IntentsUseCases.getConfirmedIntents()
  logger.info('Found confirmed intents', {
    intents: intents.map((intent) => intent.id),
  })
  for (const intent of intents) {
    const result = await IntentsUseCases.onConfirmedIntent(intent.id)
    console.log(result)

    if (result.isErr()) {
      logger.error('Error on confirmed intent', {
        error: result.error,
      })
    } else {
      logger.info('Marked intent as confirmed', {
        intentId: intent.id,
      })
    }
  }
}

const start = () => {
  logger.info('Starting payment manager')
  setInterval(
    safeCallback(checkConfirmedIntents),
    config.paymentManager.checkInterval,
  )
  viemClient.watchContractEvent({
    abi: depositEventAbi,
    address: config.paymentManager.contractAddress,
    eventName: depositEventAbi[0].name,
    onLogs: (logs) => {
      logger.info('Deposit event', {
        logs: logs.map((log) => log.transactionHash),
      })
      logs.forEach((log) => {
        watchTransaction(log.transactionHash)
      })
    },
  })
}

export const paymentManager = { watchTransaction, start }
