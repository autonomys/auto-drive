import {
  Intent,
  IntentStatus,
  User,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { intentsRepository } from '../../infrastructure/repositories/users/intents.js'
import { purchasedCreditsRepository } from '../../infrastructure/repositories/users/purchasedCredits.js'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { MAX_RETRIES } from '../../infrastructure/eventRouter/tasks.js'
import {
  BadRequestError,
  ConflictError,
  CreditCapExceededError,
  ForbiddenError,
  GoneError,
  ObjectNotFoundError,
} from '../../errors/index.js'
import { err, ok, Result } from 'neverthrow'
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

// Decimal digits only. BigInt() on its own is far more permissive than we want
// here — it accepts hex ('0x10'), binary and octal literals, surrounding
// whitespace and a leading '+', and quietly turns '' into 0n — so the shape is
// checked before conversion rather than inferred from whether it threw.
const DECIMAL_DIGITS = /^\d+$/

/**
 * Parse the wire form of `requestedBytes` into a bigint.
 *
 * Absent (or an explicit null) means "no size given", which is a legitimate
 * request on the AI3 path: the create endpoint must keep accepting the body-less
 * calls the frontend makes today. It will not be legitimate on the USDC path,
 * where the size is what the pool is quoted for — that path has to require it,
 * which is a check for the caller rather than for this parser, whose job ends at
 * the wire shape.
 *
 * A decimal string is the canonical form. Every other size on an intent
 * (shannonsPerByte, paymentAmount) already crosses the wire as a string, and a
 * string keeps working unchanged if the per-user cap ever moves past 2^53. A
 * JSON number is also accepted, since callers reach for one naturally, but only
 * while it is a safe integer — so no lossy float can enter the byte path, and a
 * caller who needs a bigger value is told to send a string instead of silently
 * having it rounded.
 *
 * Shape only. Range (positive, within the cap) is enforced in createIntent so
 * that a caller reaching the use case directly is covered by the same rules.
 */
const parseRequestedBytes = (
  raw: unknown,
): Result<bigint | undefined, BadRequestError> => {
  if (raw === undefined || raw === null) {
    return ok(undefined)
  }
  if (typeof raw === 'bigint') {
    return ok(raw)
  }
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) {
      return err(
        new BadRequestError(
          `Invalid requestedBytes: ${raw} is not a whole number of bytes ` +
            'exactly representable as a JSON number — send larger values as a ' +
            'decimal string',
        ),
      )
    }
    return ok(BigInt(raw))
  }
  if (typeof raw === 'string' && DECIMAL_DIGITS.test(raw)) {
    return ok(BigInt(raw))
  }
  return err(
    new BadRequestError(
      'Invalid requestedBytes: expected a whole number of bytes as a decimal ' +
        `string (got ${JSON.stringify(raw)})`,
    ),
  )
}

// Reject a purchase that cannot fit under the per-user credit cap, before the
// user has been asked to pay anything.
//
// THIS IS A FAST-FAIL, NOT A RESERVATION. Nothing is held: two concurrent
// intents for the same account can both pass here and both be created, and the
// sum of their sizes may exceed the cap. That is accepted. The authoritative
// check remains createPurchasedCreditWithCapCheck, which re-reads the balance
// inside a pg_advisory_xact_lock when credits are actually granted. All this
// does is spare the common case — one user asking for more than can ever fit —
// an irreversible on-chain payment followed by an OVER_CAP admin refund.
//
// Deliberately not made atomic and deliberately not a hold: a reservation needs
// an expiry sweep, release-on-failure, and its own contention story, which is a
// much larger design than the problem here warrants.
//
// It also does not bound what the user ends up with. Credits follow the amount
// actually paid, not requestedBytes, so paying more than quoted grants more than
// was checked here — and on the USDC path slightly more than proportionally,
// because the locked effective rate carries the price impact of the QUOTED size
// and a larger conversion slips further down the curve. That drift is a deliberate
// accepted cost of letting any payment amount settle an intent, and it is the
// authoritative check that bounds it: re-measuring the real balance under the
// advisory lock, an overpayment can walk an account up to the cap but never past
// it. The excess lands as OVER_CAP for admin review, which is the same place an
// unchecked purchase would have landed.
//
// Measures exactly what the authoritative check measures — SUM of
// upload_bytes_remaining over active, unexpired rows — by going through
// getRemainingCredits, whose query is that same aggregate. Any divergence
// between the two would surface as a pre-check that waves through purchases the
// real check then rejects, which is the failure mode this exists to prevent.
const checkCapHeadroom = async (
  executor: UserWithOrganization,
  requestedBytes: bigint,
): Promise<Result<void, CreditCapExceededError>> => {
  const cap = config.credits.maxBytesPerUser
  const account = await AccountsUseCases.getOrCreateAccount(executor)
  const { uploadBytesRemaining } =
    await purchasedCreditsRepository.getRemainingCredits(account.id)

  // `>` mirrors the authoritative check, so a purchase that lands exactly on the
  // cap is allowed by both. A stricter comparison here would reject purchases
  // the real check would have granted.
  if (uploadBytesRemaining + requestedBytes > cap) {
    // Clamped because an account can already sit above the cap if the cap was
    // lowered after credits were granted; a negative headroom would be nonsense
    // to show a user.
    const headroom =
      uploadBytesRemaining >= cap ? 0n : cap - uploadBytesRemaining
    logger.info(
      'Rejecting intent creation — would exceed per-user credit cap',
      {
        accountId: account.id,
        requestedBytes: requestedBytes.toString(),
        uploadBytesRemaining: uploadBytesRemaining.toString(),
        cap: cap.toString(),
      },
    )
    return err(
      new CreditCapExceededError(
        `Purchase of ${requestedBytes} bytes would exceed the per-user credit ` +
          `cap of ${cap} bytes: the account already holds ` +
          `${uploadBytesRemaining} bytes, leaving ${headroom} available`,
      ),
    )
  }

  return ok(undefined)
}

const createIntent = async (
  executor: UserWithOrganization,
  requestedBytes?: bigint,
): Promise<Result<Intent, BadRequestError | CreditCapExceededError>> => {
  // Validate and cap-check before getPrice(): that call goes over a WebSocket to
  // the consensus chain, and a request that is already invalid should not pay
  // for it.
  if (requestedBytes !== undefined) {
    if (requestedBytes <= 0n) {
      return err(
        new BadRequestError(
          `Invalid requestedBytes: ${requestedBytes} — must be a positive ` +
            'number of bytes',
        ),
      )
    }
    // A single purchase larger than the whole cap can never be granted, whatever
    // the account balance is. Failing it as a malformed request is both clearer
    // than a headroom message and cheaper — it skips the account and balance
    // reads below.
    if (requestedBytes > config.credits.maxBytesPerUser) {
      return err(
        new BadRequestError(
          `Invalid requestedBytes: ${requestedBytes} exceeds the maximum ` +
            `${config.credits.maxBytesPerUser} bytes purchasable per account`,
        ),
      )
    }

    const headroom = await checkCapHeadroom(executor, requestedBytes)
    if (headroom.isErr()) {
      return err(headroom.error)
    }
  }

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
    // What was asked for, not what will be granted: on this AI3 path credits are
    // derived from paymentAmount / shannonsPerByte and never read this value.
    quotedBytes: requestedBytes,
    expiresAt,
  })

  return ok(intent)
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
  fromAddress,
}: {
  intentId: string
  paymentAmount: bigint
  fromAddress?: string
}) => {
  const intent = await intentsRepository.getById(intentId)
  if (!intent) {
    return err(new ObjectNotFoundError('Intent not found'))
  }

  // Idempotency guard — do not overwrite an intent that is already in a
  // post-PENDING state.  Duplicate calls arise from:
  //   • chain reorgs causing the same event to be re-emitted
  //   • the payment manager reconnecting and re-processing already-seen logs
  //   • watchTransaction and the _checkConfirmedIntents polling loop racing
  //
  // We return ok() rather than an error so the caller does not treat a
  // duplicate as a failure and does not retry indefinitely.
  if (
    intent.status === IntentStatus.CONFIRMED ||
    intent.status === IntentStatus.COMPLETED ||
    intent.status === IntentStatus.OVER_CAP ||
    intent.status === IntentStatus.FAILED ||
    intent.status === IntentStatus.EXPIRED
  ) {
    logger.info('markIntentAsConfirmed: intent already processed — skipping', {
      intentId,
      currentStatus: intent.status,
    })
    return ok(intent)
  }

  return ok(
    await intentsRepository.updateIntent({
      ...intent,
      status: IntentStatus.CONFIRMED,
      paymentAmount,
      fromAddress: fromAddress ?? intent.fromAddress,
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

  // Guard: reject payments whose value is too small to purchase even a single
  // byte of storage.  getIntentCredits divides paymentAmount by shannonsPerByte
  // using BigInt integer division, so a dust payment (paymentAmount <
  // shannonsPerByte) yields 0 credits.  Granting 0 credits would mark the
  // intent COMPLETED while giving the user nothing — a misleading outcome that
  // wastes a DB row and silently discards the payment.
  //
  // Both paymentAmount and shannonsPerByte are immutable on a confirmed intent,
  // so this condition is permanent.  We mark the intent FAILED (terminal) so
  // the polling loop stops retrying.  The on-chain payment is irreversible;
  // resolution requires admin review (similar to OVER_CAP handling).
  const creditBytes = IntentsUseCases.getIntentCredits(intent)
  if (creditBytes === BigInt(0)) {
    logger.warn(
      'onConfirmedIntent: payment too small to yield any credits — marking FAILED',
      {
        intentId,
        paymentAmount: intent.paymentAmount.toString(),
        shannonsPerByte: intent.shannonsPerByte.toString(),
      },
    )
    await intentsRepository.updateIntent({
      ...intent,
      status: IntentStatus.FAILED,
    })
    return ok()
  }

  const addResult = await AccountsUseCases.addCreditsToAccount(
    intent.userPublicId,
    creditBytes,
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

// Returns PENDING intents that already have a tx_hash — used by the payment
// manager startup sweep to re-watch transactions that were submitted but never
// confirmed due to a service restart or RPC outage.
const getPendingWithTxHash = async (): Promise<Intent[]> => {
  return intentsRepository.getPendingWithTxHash()
}

export const IntentsUseCases = {
  createIntent,
  parseRequestedBytes,
  getIntent,
  updateIntent,
  triggerWatchIntent,
  onConfirmedIntent,
  markIntentAsConfirmed,
  getConfirmedIntents,
  getOverCapIntents,
  getPendingWithTxHash,
  reprocessOverCapIntent,
  getIntentCredits,
  getPrice,
  cleanupExpiredIntents,
}
