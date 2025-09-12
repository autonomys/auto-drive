import { Intent, IntentCreation, IntentStatus, User } from '@auto-drive/models'
import { intentsRepository } from '../../infrastructure/repositories/users/intents.js'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { MAX_RETRIES } from '../../infrastructure/eventRouter/tasks.js'
import { v4 } from 'uuid'
import { ForbiddenError, ObjectNotFoundError } from '../../errors/index.js'
import { err, ok } from 'neverthrow'

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
  return intentsRepository.getById(id)
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
  const intent = await getIntent(intentId)
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
  id,
  depositAmount,
}: {
  id: string
  depositAmount: bigint
}) => {
  const intent = await getIntent(id)
  if (!intent) {
    return err(new ObjectNotFoundError('Intent not found'))
  }

  return ok(
    intentsRepository.updateIntent({
      ...intent,
      status: IntentStatus.CONFIRMED,
      depositAmount,
    }),
  )
}

// Add
const onConfirmedIntent = async (id: string) => {
  const intent = await getIntent(id)
  if (!intent) {
    return err(new ObjectNotFoundError('Intent not found'))
  }

  if (intent.status !== IntentStatus.PENDING) {
    return err(new Error('Intent is already confirmed'))
  }
}

const getConfirmedIntents = async () => {
  return intentsRepository.getByStatus(IntentStatus.CONFIRMED)
}

export const IntentsUseCases = {
  createIntent,
  getIntent,
  updateIntent,
  triggerWatchIntent,
  onConfirmedIntent,
  markIntentAsConfirmed,
  getConfirmedIntents,
}
