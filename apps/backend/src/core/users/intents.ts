import { Intent, IntentCreation, IntentStatus, User } from '@auto-drive/models'
import { intentsRepository } from '../../infrastructure/repositories/users/intents.js'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { MAX_RETRIES } from '../../infrastructure/eventRouter/tasks.js'
import { v4 } from 'uuid'
import { ForbiddenError, ObjectNotFoundError } from '../../errors/index.js'
import { err, ok } from 'neverthrow'
import { config } from '../../config.js'

const createIntent = async (
  executor: User,
  intentCreation: IntentCreation,
): Promise<Intent> => {
  const intent = await intentsRepository.createIntent({
    id: v4(),
    userPublicId: executor.publicId,
    status: IntentStatus.PENDING,
    expiresAt: intentCreation.expiresAt,
    depositAmount: undefined,
  })

  return intent
}

const getIntent = async (id: string) => {
  const intent = await intentsRepository.getById(id)
  if (!intent) {
    return err(new ObjectNotFoundError('Intent not found'))
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
  const result = await getIntent(intentId)
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
      intentId,
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
  depositAmount,
}: {
  intentId: string
  depositAmount: bigint
}) => {
  const result = await getIntent(intentId)
  if (result.isErr()) {
    return err(result.error)
  }
  const intent = result.value

  return ok(
    intentsRepository.updateIntent({
      ...intent,
      status: IntentStatus.CONFIRMED,
      depositAmount,
    }),
  )
}

// Add
const onConfirmedIntent = async (intentId: string) => {
  const result = await getIntent(intentId)
  if (result.isErr()) {
    return err(result.error)
  }
  const intent = result.value

  if (intent.status !== IntentStatus.PENDING) {
    return err(new Error('Intent is already confirmed'))
  }
}

const getConfirmedIntents = async () => {
  return intentsRepository.getByStatus(IntentStatus.CONFIRMED)
}

const getPrice = async (): Promise<{ price: number }> => {
  return { price: config.paymentManager.pricePerMB }
}

export const IntentsUseCases = {
  createIntent,
  getIntent,
  updateIntent,
  triggerWatchIntent,
  onConfirmedIntent,
  markIntentAsConfirmed,
  getConfirmedIntents,
  getPrice,
}
