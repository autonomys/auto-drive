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

  const receipt = await viemClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
    confirmations: config.paymentManager.confirmations,
  })

  // Filter logs to only include the deposit event
  const logs = parseEventLogs({
    abi: depositEventAbi,
    eventName: depositEventAbi[0].name,
    logs: receipt.logs,
  }).filter((log) => log.address === config.paymentManager.contractAddress)

  const results = await Promise.all(
    logs.map((log) => {
      logger.info('Deposit event', {
        intentId: log.args.intentId,
        depositAmount: log.args.depositAmount,
      })
      return IntentsUseCases.markIntentAsConfirmed({
        id: log.args.intentId,
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
  const intents = await IntentsUseCases.getConfirmedIntents()
  intents.forEach((intent) => {
    IntentsUseCases.onConfirmedIntent(intent.id)
  })
}

const start = () => {
  setInterval(
    safeCallback(checkConfirmedIntents),
    config.paymentManager.checkInterval,
  )
  viemClient.watchContractEvent({
    abi: depositEventAbi,
    address: config.paymentManager.contractAddress,
    eventName: depositEventAbi[0].name,
    onLogs: (logs) => {
      logs.forEach((log) => {
        watchTransaction(log.transactionHash)
      })
    },
  })
}

export const paymentManager = { watchTransaction, start }
