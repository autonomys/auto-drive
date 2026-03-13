import { Intent, IntentStatus, User, UserRole } from '@auto-drive/models'
import { intentsRepository } from '../../infrastructure/repositories/users/intents.js'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { MAX_RETRIES } from '../../infrastructure/eventRouter/tasks.js'
import {
  ConflictError,
  ForbiddenError,
  GoneError,
  ObjectNotFoundError,
} from '../../errors/index.js'
import { err, ok } from 'neverthrow'
import { config } from '../../config.js'
import { randomBytes } from 'crypto'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { AccountsUseCases } from './accounts.js'
import { transactionByteFee } from '@autonomys/auto-consensus'
import { ApiPromise, WsProvider } from '@polkadot/api'

const logger = createLogger('IntentsUseCases')

// Singleton API instance for price queries to prevent memory leaks
// Each ApiPromise creates WebSocket connections and WASM modules that are never garbage collected
let priceApiPromise: Promise<ApiPromise> | null = null

const getPriceApi = async (): Promise<ApiPromise> => {
  if (!priceApiPromise) {
    logger.debug('Creating singleton Polkadot API for price queries')
    const provider = new WsProvider(config.chain.endpoint)
    priceApiPromise = ApiPromise.create({ provider })

    // Handle disconnection - reset the singleton so it reconnects on next call
    priceApiPromise
      .then((api) => {
        api.on('disconnected', () => {
          logger.warn('Price API disconnected, will reconnect on next query')
          priceApiPromise = null
        })
        api.on('error', (error) => {
          logger.error(error, 'Price API error, resetting connection')
          priceApiPromise = null
        })
      })
      .catch((error) => {
        // Reset on initial connection failure to allow recovery on next call
        logger.error(error, 'Price API failed to connect, resetting for retry')
        priceApiPromise = null
      })
  }

  return priceApiPromise
}

const randomBytes32 = () => {
  return '0x' + randomBytes(32).toString('hex')
}

// Returns true if the intent has passed its price-lock window.
// Only PENDING intents can expire — once an intent is CONFIRMED or COMPLETED
// the expiry window is irrelevant.
// Intents with a txHash are actively being watched on-chain and must not be
// treated as expired — their resolution comes from markIntentAsConfirmed.
// Intents without an expiresAt (pre-feature rows) are considered expired.
const isIntentExpired = (intent: Intent): boolean => {
  if (intent.status === IntentStatus.EXPIRED) return true
  if (intent.status !== IntentStatus.PENDING) return false
  if (intent.txHash) return false
  if (!intent.expiresAt) return true
  return intent.expiresAt < new Date()
}

const createIntent = async (executor: User): Promise<Intent> => {
  const { price } = await IntentsUseCases.getPrice()

  const expiresAt = new Date(
    Date.now() + config.credits.intentExpiryMinutes * 60 * 1000,
  )

  const intent = await intentsRepository.createIntent({
    id: randomBytes32(),
    userPublicId: executor.publicId,
    status: IntentStatus.PENDING,
    paymentAmount: undefined,
    shannonsPerByte: BigInt(price),
    expiresAt,
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

  if (isIntentExpired(intent)) {
    return err(new GoneError('Intent has expired'))
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

const getIntentCredits = (intent: Intent): bigint => {
  if (!intent.paymentAmount) {
    return BigInt(0)
  }

  return BigInt(intent.paymentAmount) / BigInt(intent.shannonsPerByte)
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

  const addResult = await AccountsUseCases.addCreditsToAccount(
    intent.userPublicId,
    IntentsUseCases.getIntentCredits(intent),
    intentId,
  )

  if (addResult.isErr()) {
    if (addResult.error instanceof ForbiddenError) {
      // The user's purchased credit balance is at or above the per-user cap.
      // Mark the intent OVER_CAP (terminal) so the polling loop stops retrying
      // and an admin can review.  The payment is on-chain; resolution requires
      // a manual decision (adjust cap + reprocess, or arrange a refund).
      logger.warn('Intent blocked by per-user cap — marking OVER_CAP', {
        intentId,
        userPublicId: intent.userPublicId,
        paymentAmount: intent.paymentAmount.toString(),
      })
      await intentsRepository.updateIntent({
        ...intent,
        status: IntentStatus.OVER_CAP,
      })
      return ok()
    }
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

// Returns all intents stuck in OVER_CAP for admin review.
// Only accessible to admin users — returns ForbiddenError for everyone else.
const getOverCapIntents = async (executor: User) => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }
  const intents = await intentsRepository.getOverCapIntents()
  return ok(intents)
}

// Resets an OVER_CAP intent back to CONFIRMED so the payment manager polling
// loop will attempt to grant credits on its next tick.
//
// Intended admin workflow:
//  1. Admin calls POST /accounts/update to raise the user's credit cap.
//  2. Admin calls POST /intents/:id/reprocess to re-queue this intent.
//  3. The polling loop picks it up within 30 seconds and calls onConfirmedIntent.
//
// Returns ConflictError if the intent is not in OVER_CAP status — this guards
// against accidentally re-queuing an already COMPLETED or PENDING intent.
const reprocessOverCapIntent = async (executor: User, intentId: string) => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const intent = await intentsRepository.getById(intentId)
  if (!intent) {
    return err(new ObjectNotFoundError('Intent not found'))
  }

  if (intent.status !== IntentStatus.OVER_CAP) {
    return err(
      new ConflictError(
        `Intent is not in OVER_CAP status (current: ${intent.status})`,
      ),
    )
  }

  await intentsRepository.updateIntent({
    ...intent,
    status: IntentStatus.CONFIRMED,
  })

  logger.info('Admin requeued OVER_CAP intent for reprocessing', {
    intentId,
    adminPublicId: executor.publicId,
  })

  return ok()
}

// Marks all PENDING intents whose price-lock window has expired.
// Called periodically by the background job so that stale PENDING rows do not
// accumulate.  CONFIRMED intents are not touched — once payment is confirmed
// the intent must be processed regardless of the original expiry window.
//
// Uses expireIntentIfPending (atomic conditional UPDATE with
// WHERE status = 'pending') instead of a read-then-write to avoid a TOCTOU
// race: if markIntentAsConfirmed promotes the intent to CONFIRMED between our
// SELECT and UPDATE, the conditional UPDATE simply no-ops instead of
// overwriting the CONFIRMED status and paymentAmount with stale data.
const cleanupExpiredIntents = async (): Promise<void> => {
  const expired = await intentsRepository.getExpiredPendingIntents()
  if (expired.length === 0) return

  logger.info('Marking expired intents', { count: expired.length })

  const results = await Promise.all(
    expired.map((intent) =>
      intentsRepository.expireIntentIfPending(intent.id),
    ),
  )

  const actuallyExpired = results.filter(Boolean).length
  if (actuallyExpired < expired.length) {
    logger.info(
      'Some intents were not expired (status changed concurrently)',
      { attempted: expired.length, expired: actuallyExpired },
    )
  }
}

const BYTES_PER_GB = 1024 * 1024 * 1024
const SHANNONS_PER_AI3 = 1e18

const getPrice = async (): Promise<{ price: number; pricePerGB: number }> => {
  const api = await getPriceApi()
  const { current: currentPricePerByte } = await transactionByteFee(api)

  const price = Math.floor(
    currentPricePerByte * config.paymentManager.priceMultiplier,
  )

  return {
    price,
    pricePerGB: Math.round((price * BYTES_PER_GB) / SHANNONS_PER_AI3 * 100) / 100,
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
  getOverCapIntents,
  reprocessOverCapIntent,
  getIntentCredits,
  getPrice,
  cleanupExpiredIntents,
}
