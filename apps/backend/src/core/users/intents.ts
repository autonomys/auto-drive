import { Intent, IntentStatus, User } from '@auto-drive/models'
import { intentsRepository } from '../../infrastructure/repositories/users/intents.js'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { MAX_RETRIES } from '../../infrastructure/eventRouter/tasks.js'
import { ForbiddenError, ObjectNotFoundError } from '../../errors/index.js'
import { err, ok } from 'neverthrow'
import { config } from '../../config.js'
import { randomBytes } from 'crypto'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { SubscriptionsUseCases } from './subscriptions.js'
import { transactionByteFee } from '@autonomys/auto-consensus'
import { ApiPromise, WsProvider } from '@polkadot/api'

const logger = createLogger('IntentsUseCases')

const randomBytes32 = () => {
  return '0x' + randomBytes(32).toString('hex')
}

const createIntent = async (executor: User): Promise<Intent> => {
  const { price } = await IntentsUseCases.getPrice()

  const intent = await intentsRepository.createIntent({
    id: randomBytes32(),
    userPublicId: executor.publicId,
    status: IntentStatus.PENDING,
    paymentAmount: undefined,
    shannonsPerByte: BigInt(price),
  })

  return intent
}

const getIntent = async (user: User, id: string) => {
  const intent = await intentsRepository.getById(id)
  if (!intent) {
    return err(new ObjectNotFoundError('Intent not found'))
  }

  if (user.publicId !== intent.userPublicId) {
    return err(new ForbiddenError('Intent not found'))
  }

  return ok(intent)
}

const updateIntent = async (intent: Intent) => {
  return intentsRepository.updateIntent(intent)
}

const triggerWatchIntent = async ({
  executor,
  txHash,
  intentId,
}: {
  executor: User
  txHash: string
  intentId: string
}) => {
  const result = await getIntent(executor, intentId)
  if (result.isErr()) {
    return err(result.error)
  }
  const intent = result.value

  if (intent?.userPublicId !== executor.publicId) {
    return err(new ForbiddenError('Intent not found'))
  }

  EventRouter.publish({
    id: 'watch-intent-tx',
    retriesLeft: MAX_RETRIES,
    params: {
      txHash,
    },
  })

  await intentsRepository.updateIntent({
    ...intent,
    txHash,
  })

  return ok()
}

const markIntentAsConfirmed = async ({
  intentId,
  paymentAmount,
}: {
  intentId: string
  paymentAmount: bigint
}) => {
  const intent = await intentsRepository.getById(intentId)
  if (!intent) {
    return err(new ObjectNotFoundError('Intent not found'))
  }

  return ok(
    intentsRepository.updateIntent({
      ...intent,
      status: IntentStatus.CONFIRMED,
      paymentAmount,
    }),
  )
}

const getIntentCredits = (intent: Intent) => {
  if (!intent.paymentAmount) {
    return 0
  }

  const creditsInBytes =
    BigInt(intent.paymentAmount) / BigInt(intent.shannonsPerByte)

  return Number(creditsInBytes).valueOf()
}

const onConfirmedIntent = async (intentId: string) => {
  const intent = await intentsRepository.getById(intentId)
  if (!intent) {
    return err(new ObjectNotFoundError('Intent not found'))
  }

  if (intent.status === IntentStatus.COMPLETED) {
    return err(new Error('Intent should be not completed'))
  }

  if (!intent.paymentAmount) {
    logger.warn('Intent has no deposit amount', {
      intentId,
    })
    return err(new Error('Intent has no deposit amount'))
  }

  const addResult = await SubscriptionsUseCases.addCreditsToSubscription(
    intent.userPublicId,
    IntentsUseCases.getIntentCredits(intent),
  )
  if (addResult.isErr()) {
    return err(addResult.error)
  }

  await intentsRepository.updateIntent({
    ...intent,
    status: IntentStatus.COMPLETED,
  })

  return ok()
}

const getConfirmedIntents = async () => {
  return intentsRepository.getByStatus(IntentStatus.CONFIRMED)
}

const getPrice = async (): Promise<{ price: number }> => {
  const { current: currentPricePerByte } = await transactionByteFee(
    new ApiPromise({ provider: new WsProvider(config.chain.endpoint) }),
  )

  return {
    price: currentPricePerByte * config.paymentManager.priceMultiplier,
  }
}

export const IntentsUseCases = {
  createIntent,
  getIntent,
  updateIntent,
  triggerWatchIntent,
  onConfirmedIntent,
  markIntentAsConfirmed,
  getConfirmedIntents,
  getIntentCredits,
  getPrice,
}
