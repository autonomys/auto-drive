import {
  Intent,
  IntentMispaymentReason,
  IntentStatus,
  PaymentMethod,
  User,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { intentsRepository } from '../../infrastructure/repositories/users/intents.js'
import { intentMispaymentsRepository } from '../../infrastructure/repositories/users/intentMispayments.js'
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
  QuoteErrorCode,
  QuoteFailedError,
  ServiceUnavailableError,
  UsdcPaymentsDisabledError,
} from '../../errors/index.js'
import { err, ok, Result } from 'neverthrow'
import { config } from '../../config.js'
import { randomBytes } from 'crypto'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { AccountsUseCases } from './accounts.js'
import { FeatureFlagsUseCases } from '../featureFlags/index.js'
import { transactionByteFee } from '@autonomys/auto-consensus'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { priceOracle } from '../../infrastructure/services/priceOracle/index.js'
import { OracleUnavailableError } from '../../infrastructure/services/priceOracle/types.js'
import {
  ai3ShannonsToUsdcBaseUnits,
  applyMarginPercent,
} from '../../shared/utils/index.js'

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
// Intents without an expiresAt (pre-feature rows) are considered expired.
//
// A txHash exempts the intent while it could still plausibly resolve: it is
// being watched on-chain and the answer comes from markIntentAsConfirmed. That
// exemption is time-bounded rather than permanent, because it assumes a hash
// resolves, and a refused payment or a transaction that never confirms both
// break the assumption — leaving a row that getIntent advertises as payable
// forever, long past the price lock it was quoted under. Past
// intentTxGraceMinutes the hash stops earning the exemption. Kept in step with
// getExpiredPendingIntents, so what this reports and what cleanup reclaims are
// the same set.
const isIntentExpired = (intent: Intent): boolean => {
  if (intent.status === IntentStatus.EXPIRED) return true
  if (intent.status !== IntentStatus.PENDING) return false
  if (intent.txHash) {
    // A pre-feature row has no window to be past, so the hash keeps its
    // exemption — as it did before this grace existed.
    if (!intent.expiresAt) return false
    const graceMs = config.credits.intentTxGraceMinutes * 60 * 1000
    return intent.expiresAt.getTime() + graceMs < Date.now()
  }
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
 * where the size is what the charge is computed FROM: the oracle now reports a
 * size-independent VWAP of realized fills (#746, landed in #807), so it prices a
 * byte and the intent has to say how many. That path therefore has to require a
 * size — a check for the caller rather than for this parser, whose job ends at
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

/**
 * Parse the wire form of `paymentMethod`.
 *
 * Absent means AI3 — the live frontend posts no body at all, and that request
 * must keep meaning exactly what it means today.
 *
 * An unrecognised value is rejected rather than defaulted. Defaulting would let a
 * typo ('usdc', 'USDC_ETH') quietly create an AI3 intent, and the caller would
 * only find out when the payment they were told to make in USDC was expected in
 * AI3. Like parseRequestedBytes this checks the wire shape only.
 */
const parsePaymentMethod = (
  raw: unknown,
): Result<PaymentMethod, BadRequestError> => {
  if (raw === undefined || raw === null) {
    return ok(PaymentMethod.AI3_NATIVE)
  }
  const known = Object.values(PaymentMethod) as string[]
  if (typeof raw === 'string' && known.includes(raw)) {
    return ok(raw as PaymentMethod)
  }
  return err(
    new BadRequestError(
      `Invalid paymentMethod: expected one of ${known.join(', ')} (got ` +
        `${JSON.stringify(raw)})`,
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
// was checked here — proportionally more, on either payment method, because an
// intent locks a single scalar rate (shannonsPerByte, and on the USDC path the
// effective rate #747 persists) and nothing on it varies with the size paid for.
// That drift is a deliberate accepted cost of letting any payment amount settle
// an intent, and it is the authoritative check that bounds it: re-measuring the
// real balance under the advisory lock, an overpayment can walk an account up to
// the cap but never past it. The excess lands as OVER_CAP for admin review,
// which is the same place an unchecked purchase would have landed.
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

// Map a price-oracle failure onto a client-facing code.
//
// Every one of them is a 503, carried by QuoteFailedError itself. That is a
// narrowing: this mapping used to send two of four causes back as 4xx — 409 "the
// pool cannot fill it, ask for less" and 400 "the amount is out of the quoter's
// range". Both told the user to change the size, and since #807 no oracle
// failure is about the size. The rate is one size-independent average of
// realized fills; it is refused for the market or for the source, never for how
// much was asked for. A 4xx here would blame a request that was fine.
//
// Still two codes rather than one, because the oracle draws the distinction
// deliberately and flattening it misdirects whoever reads the response: a market
// that has re-priced past its own window is a different fact from a source we
// could not read, even though both mean "not right now".
//
// Takes OracleUnavailableError rather than Error because that is what
// priceOracle.getPrice() can fail with — the Result type says so. The default
// branch is not defence against some other error class arriving; it is the
// mapping's answer for reasons added to OracleUnavailableReason after this was
// written, which is a union that has grown twice already.
const quoteErrorToHttpError = (
  error: OracleUnavailableError,
): QuoteFailedError => {
  if (error.reason === 'market-moved') {
    return new QuoteFailedError(QuoteErrorCode.PRICE_UNSTABLE, error.message)
  }
  // Every other reason, and anything the oracle grows later: an unrecognised
  // failure is our problem and retryable, which is the safe default.
  return new QuoteFailedError(QuoteErrorCode.ORACLE_UNAVAILABLE, error.message)
}

type CreateIntentOptions = {
  // How many bytes the purchase is for. Optional on the AI3 path, where it only
  // gates creation against the cap. REQUIRED for USDC_ETH, which has to quote a
  // specific size.
  requestedBytes?: bigint
  // Defaults to AI3_NATIVE so existing callers — including the live frontend,
  // which posts no body — keep their current behaviour exactly.
  paymentMethod?: PaymentMethod
}

// An options object rather than a third positional parameter. Two optional
// bigint/enum arguments in a row on a money path is the shape where a
// transposed call site silently prices the wrong thing, and the compiler would
// not catch swapping them if both were positional.
const createIntent = async (
  executor: UserWithOrganization,
  {
    requestedBytes,
    paymentMethod = PaymentMethod.AI3_NATIVE,
  }: CreateIntentOptions = {},
): Promise<
  Result<
    Intent,
    | BadRequestError
    | CreditCapExceededError
    | QuoteFailedError
    | ServiceUnavailableError
    | UsdcPaymentsDisabledError
  >
> => {
  // Is this caller allowed to pay in USDC at all?
  //
  // First, before the request is even validated: a caller who cannot use the
  // asset should be told that, not walked through a critique of a body that was
  // never going to be quoted. It also keeps the closed path cheap — no account
  // read, no balance read, no chain round-trip.
  //
  // Checked in the use case rather than in the controller, for the same reason
  // the requestedBytes rule is: `POST /intents` is not the only door, and a
  // caller reaching this function directly must be held to the same rule.
  //
  // Admins are exempt by construction (see featureFlags/isActive), which is what
  // makes the flag safe to leave off — the path stays exercisable in production
  // while it is shut to everyone else.
  if (
    paymentMethod === PaymentMethod.USDC_ETH &&
    !FeatureFlagsUseCases.isFlagActive('payWithUsdc', executor)
  ) {
    logger.info('Rejecting USDC intent creation — feature not open to caller', {
      userPublicId: executor.publicId,
    })
    return err(
      new UsdcPaymentsDisabledError(
        'Paying in USDC is not available on this account. Pay in AI3 instead, ' +
          'or omit paymentMethod to default to it.',
      ),
    )
  }

  // The USDC path cannot price a purchase without knowing its size, so the size
  // is required there and optional on AI3.
  //
  // Not a stylistic asymmetry — the two paths owe different things at creation.
  // An AI3 intent locks a per-byte rate and lets whatever arrives on-chain
  // settle it, so it can be created without anyone having decided how much to
  // buy. A USDC intent has to name a number the user is asked to transfer, and
  // that number is the oracle's rate times the size: the rate prices ONE BYTE
  // (a VWAP of realized fills, size-independent since #807), so without a size
  // there is no amount to charge and nothing to put in quoted_token_amount.
  //
  // Checked here rather than in parseRequestedBytes because a caller reaching
  // this use case directly must be held to the same rule — the parser's job
  // ends at the wire shape. Enforced at all rather than by making the field
  // required on the endpoint, because `POST /intents` is a documented API-key
  // flow for third-party integrators (see featureFlags.hasGoogleAuth) and every
  // one of them is on AI3 today.
  if (paymentMethod === PaymentMethod.USDC_ETH && requestedBytes === undefined) {
    return err(
      new BadRequestError(
        'requestedBytes is required when paying in USDC: the amount charged ' +
          'is the per-byte rate times the purchase size, so there is nothing ' +
          'to quote without it',
      ),
    )
  }

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
  const shannonsPerByte = BigInt(price)

  // An intent priced at zero per byte is a trap, not a bargain. Every payment
  // made against it converts to zero credits — getIntentCredits divides by this
  // number and returns 0 rather than throwing — so the intent lands in FAILED
  // with the payment kept and nothing bought. On the USDC path it is worse
  // still: the quote itself computes to 0, and the user is shown a binding
  // amount of "nothing" for a purchase that will never be granted.
  //
  // Reachable from CREDITS_PRICE_MULTIPLIER=0 or a chain reporting a zero byte
  // fee — a misconfiguration rather than a market condition, which is why it is
  // a 503 and not a 4xx: the request was fine, the deployment is not.
  //
  // Guarded on both paths, though only the USDC one produces a misleading quote:
  // the downstream failure is identical, and an intent nobody can settle should
  // not be created whichever asset it names. The zero check in getIntentCredits
  // stays as defence for rows written before this existed.
  if (shannonsPerByte === 0n) {
    logger.error('Refusing to create an intent at a zero per-byte price', {
      userPublicId: executor.publicId,
      paymentMethod,
      priceMultiplier: config.paymentManager.priceMultiplier,
    })
    return err(
      new ServiceUnavailableError(
        'Storage is not priceable right now: the per-byte rate resolved to ' +
          'zero. This is a server-side condition — retry shortly.',
      ),
    )
  }

  const expiresAt = new Date(
    Date.now() + config.credits.intentExpiryMinutes * 60 * 1000,
  )

  // AI3 path: requestedBytes is deliberately not persisted. It exists to gate
  // creation against the cap, and nothing downstream reads it — credits are
  // derived from paymentAmount / shannonsPerByte, so a stored copy would be a
  // number that looks like a balance, never agrees with one, and has no reader.
  if (paymentMethod !== PaymentMethod.USDC_ETH) {
    const intent = await intentsRepository.createIntent({
      id: randomBytes32(),
      userPublicId: executor.publicId,
      status: IntentStatus.PENDING,
      paymentAmount: undefined,
      shannonsPerByte,
      paymentMethod,
      expiresAt,
    })

    return ok(intent)
  }

  // USDC path. requestedBytes is guaranteed present by the guard above.
  //
  // Quote the AI3 the purchase is worth, not the bytes: the oracle prices AI3,
  // and shannonsPerByte is what ties the two together. Locking both numbers on
  // the same intent is what makes the charge reproducible.
  const quotedAi3Shannons = requestedBytes! * shannonsPerByte

  // A last-good rate prices the quote exactly as a fresh one does, and that is a
  // decision rather than an oversight. The oracle's number is a volume-weighted
  // average over days of realized fills, so the ORACLE_MAX_STALE_MS window (10
  // minutes) cannot move it the way it would move a spot price — while refusing
  // to quote through every subgraph blip would shut the purchase path far more
  // often than the drift justifies. `stale` and `asOf` are recorded on every
  // quote below, so a charge can still be explained after the fact.
  //
  // The guard that DOES fire on a moved market is `market-moved`, which the
  // oracle raises against the window itself rather than against its age.
  const rate = await priceOracle.getPrice()
  if (rate.isErr()) {
    logger.info(
      'Rejecting USDC intent creation — could not quote the purchase',
      {
        userPublicId: executor.publicId,
        requestedBytes: requestedBytes!.toString(),
        quotedAi3Shannons: quotedAi3Shannons.toString(),
        // The reason, not just the message: it is the enum the admin dashboard
        // and #811's kill switch read, and it says which guard closed the door.
        reason: rate.error.reason,
        message: rate.error.message,
      },
    )
    return err(quoteErrorToHttpError(rate.error))
  }

  // A rate times an amount, because the rate prices ONE BYTE and knows nothing
  // about size — the same number quotes a $5 purchase and a $500 one. This used
  // to ask the pool what this specific size would fill at, which folded the swap
  // fee and that size's own price impact into the answer; #807 replaced it with
  // an average of realized fills, and those two costs now arrive inside the rate
  // (the fills paid them) rather than as a function of what is being bought.
  //
  // So the margin is the ONLY wedge left between the rate shown and the amount
  // charged. It carries drift while the price lock is open and the cost of
  // converting a batch later, since the treasury no longer swaps per intent.
  // Reasoning lives in pricing.ts; do not re-derive it here.
  const quotedTokenAmount = applyMarginPercent(
    ai3ShannonsToUsdcBaseUnits(quotedAi3Shannons, rate.value.usdPerAi3),
    config.credits.usdQuoteMarginPercent,
  )

  const intent = await intentsRepository.createIntent({
    id: randomBytes32(),
    userPublicId: executor.publicId,
    status: IntentStatus.PENDING,
    paymentAmount: undefined,
    shannonsPerByte,
    paymentMethod,
    // The charge, and what it was charged for. The pair is the effective rate the
    // confirmation path converts at — see getIntentCredits.
    quotedTokenAmount,
    quotedAi3Shannons,
    // The raw oracle rate, for display and reconciliation only. NEVER convert a
    // payment at this rate: it is short by the margin the user actually paid, so
    // doing so grants that margin back as free storage.
    usdRateAtCreation: rate.value.usdPerAi3,
    expiresAt,
  })

  logger.info('Created USDC intent with a locked quote', {
    intentId: intent.id,
    userPublicId: executor.publicId,
    requestedBytes: requestedBytes!.toString(),
    quotedAi3Shannons: quotedAi3Shannons.toString(),
    quotedTokenAmount: quotedTokenAmount.toString(),
    usdPerAi3: rate.value.usdPerAi3.toString(),
    // Whether the rate that priced this purchase was the last-good fallback
    // rather than a fresh read, and how old it is. Both are needed to explain a
    // charge after the fact.
    rateAsOf: rate.value.asOf.toISOString(),
    rateStale: rate.value.stale,
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

  // Claim the row before queueing anything, and write only the hash.
  //
  // This used to write the whole intent back from the snapshot getIntent returned,
  // which meant a confirmation landing between the read and the write was undone:
  // status reverted to PENDING and payment_amount nulled, so a payment that had
  // already been credited became uncredited and stayed that way until a restart's
  // recovery sweep re-watched the row. Conditional on PENDING, one column, so
  // there is nothing stale to write back.
  const claimed = await intentsRepository.setTxHashIfPending(intentId, txHash)

  if (!claimed) {
    // The intent left PENDING between the read above and this write, so the hash
    // was not recorded. Not an error, and not a reason to stop: the column and the
    // watch are separate concerns.
    logger.info(
      'triggerWatchIntent: intent left PENDING before the hash was recorded',
      { intentId, txHash },
    )
  }

  // Published either way, including when the claim failed.
  //
  // Writing the hash is the part that could revert a confirmation; watching the
  // transaction is what observes the payment, and that is worth doing precisely
  // when the intent is no longer PENDING. A caller submitting a hash for an intent
  // that is already settled is describing a second payment, and one for an intent
  // that just expired is describing a payment that arrived too late — both of
  // which markIntentAsConfirmed records rather than discards. Skipping the publish
  // would remove the only path by which either is ever seen, which is a worse
  // outcome than the stale write this function used to do.
  EventRouter.publish({
    id: 'watch-intent-tx',
    retriesLeft: MAX_RETRIES,
    params: {
      txHash,
      // Which chain to look this hash up on. The task carries it because the
      // worker that handles it cannot derive it: a hash is the same 32 bytes on
      // either chain, and by the time the task runs the intent may have been
      // expired by the cleanup sweep. Sent even for AI3 so the routing decision
      // is always a value rather than an absence.
      paymentMethod: intent.paymentMethod ?? PaymentMethod.AI3_NATIVE,
    },
  })

  return ok()
}

/**
 * Write down a payment we refused to attach to an intent.
 *
 * Never throws. The caller is already on its way to returning a refusal, and a
 * failure to file the paperwork must not become a different error than the one
 * that actually happened — the watcher would log the wrong cause, and on the
 * startup-sweep path it would abort the recovery of unrelated transactions.
 * A failed write degrades to the log line we had before, which is the floor
 * rather than the goal.
 */
const recordMispayment = async (
  mispayment: Parameters<typeof intentMispaymentsRepository.record>[0],
): Promise<void> => {
  try {
    const recorded = await intentMispaymentsRepository.record(mispayment)
    if (recorded) {
      logger.warn('Recorded a mispayment for admin review', {
        mispaymentId: recorded.id,
        intentId: recorded.intentId,
        reason: recorded.reason,
        txHash: recorded.txHash,
      })
    }
    // A null return is the ON CONFLICT path: this (transaction, intent) is
    // already on file, which is the expected outcome of a reorg or the startup
    // sweep replaying it. Not worth a line.
  } catch (error) {
    logger.error('Failed to record a mispayment — it survives only in logs', {
      intentId: mispayment.intentId,
      reason: mispayment.reason,
      txHash: mispayment.txHash,
      paymentAmount: mispayment.paymentAmount?.toString(),
      tokenAmount: mispayment.tokenAmount?.toString(),
      fromAddress: mispayment.fromAddress,
      error,
    })
  }
}

const markIntentAsConfirmed = async ({
  intentId,
  paymentAmount,
  tokenAmount,
  fromAddress,
  txHash,
  logIndex,
}: {
  intentId: string
  // AI3 path: shannons received on Auto EVM.
  paymentAmount?: bigint
  // USDC path: token base units received (USDC has 6 decimals). Recorded on its
  // own column rather than reusing paymentAmount, which is denominated in
  // shannons — putting USDC in it would make every AI3-shaped read of the row
  // silently wrong, starting with the dust guard in onConfirmedIntent.
  tokenAmount?: bigint
  fromAddress?: string
  // The transaction the payment arrived in. Carried purely so a refusal can be
  // recorded against something an admin can look up on a block explorer — an
  // amount and a sender describe a payment, but only the hash finds it.
  txHash?: string
  // Where the payment event sat inside that transaction. With txHash it names
  // one payment, which is what lets a recorded refusal de-duplicate across the
  // watcher's replays while still filing both halves of a transaction that paid
  // the same intent twice.
  logIndex?: number
}) => {
  // Exactly one of the two is expected, but neither is the failure worth
  // catching: it would confirm an intent with nothing received, which later
  // surfaces as a 0-credit FAILED row that has to be diagnosed backwards from
  // an on-chain payment.
  if (paymentAmount === undefined && tokenAmount === undefined) {
    return err(
      new BadRequestError(
        `Cannot confirm intent ${intentId}: neither an AI3 paymentAmount nor a ` +
          'tokenAmount was supplied',
      ),
    )
  }

  const intent = await intentsRepository.getById(intentId)
  if (!intent) {
    // A payment naming an intent that does not exist. Nothing can be done with
    // it in code, which is exactly why it is written down: this is the case with
    // the least evidence attached, and a log line is not evidence anyone finds.
    logger.warn('markIntentAsConfirmed: payment for an unknown intent', {
      intentId,
      txHash,
    })
    await recordMispayment({
      intentId,
      reason: IntentMispaymentReason.UNKNOWN_INTENT,
      paymentAmount,
      tokenAmount,
      fromAddress,
      txHash,
      logIndex,
    })
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
    intent.status === IntentStatus.FAILED
  ) {
    // Re-delivery of the payment that settled this intent, or a second payment
    // that arrived after it? The guard used to treat both as the same no-op, so
    // paying an intent twice credited the first transfer and absorbed the second
    // without a trace — no credits, no row, no log line beyond "already
    // processed". Two transfers is not an exotic mistake: a user who does not see
    // the first confirm pays the same quote again.
    //
    // Two signals, because neither alone is sound. A differing tx hash proves a
    // different transaction, but only when the intent carries one — rows settled
    // before confirmations began recording the hash have none, and comparing
    // against NULL would file every replay of those as a second payment. A
    // differing amount proves a different payment outright, and is available on
    // every row, but says nothing when someone pays the same amount twice.
    //
    // A payment in the other asset is a third signal, and an unambiguous one.
    //
    // None of them separates two logs of the same value inside one transaction,
    // where the hash matches and the amounts agree. That case does not reach here:
    // both arrive while the intent is still PENDING, and the conditional
    // transition below is what tells them apart — whichever loses the UPDATE is
    // filed by that path rather than this one.
    const settledAmount =
      intent.paymentMethod === PaymentMethod.USDC_ETH
        ? intent.tokenAmount
        : intent.paymentAmount
    const incomingAmount =
      intent.paymentMethod === PaymentMethod.USDC_ETH
        ? tokenAmount
        : paymentAmount
    const differentTransaction =
      txHash !== undefined &&
      intent.txHash !== undefined &&
      intent.txHash !== txHash
    const differentAmount =
      incomingAmount !== undefined && incomingAmount !== settledAmount
    // The payment is denominated in the other asset, so it cannot be re-delivery
    // of the one that settled this intent — that one had to be in the asset the
    // intent was quoted in to have settled it at all. One of the two amounts is
    // always present by the guard at the top of this function.
    const differentAsset = incomingAmount === undefined

    if (differentTransaction || differentAmount || differentAsset) {
      logger.warn(
        'markIntentAsConfirmed: a second payment arrived for a settled intent — recording it',
        {
          intentId,
          currentStatus: intent.status,
          settledTxHash: intent.txHash,
          settledAmount: settledAmount?.toString(),
          received: incomingAmount?.toString(),
          txHash,
        },
      )
      await recordMispayment({
        intentId,
        reason: IntentMispaymentReason.ALREADY_SETTLED,
        expectedPaymentMethod: intent.paymentMethod ?? PaymentMethod.AI3_NATIVE,
        paymentAmount,
        tokenAmount,
        fromAddress,
        txHash,
        logIndex,
      })
    } else {
      logger.info('markIntentAsConfirmed: intent already processed — skipping', {
        intentId,
        currentStatus: intent.status,
      })
    }

    // ok() either way. The intent is settled and correct; nothing here is a
    // failure the watcher should retry.
    return ok(intent)
  }

  // A payment for an intent whose price lock has lapsed.
  //
  // Handled apart from the statuses above because it is not the same kind of
  // no-op. Those four mean the intent was already resolved and this call is
  // re-delivery of something we acted on. EXPIRED means the opposite: nothing was
  // ever paid as far as the row knows, so money arriving now is a payment we have
  // no record of anywhere. Granting it is not an option — the rate it was quoted
  // under is gone — but returning quietly leaves an irreversible transfer with
  // nothing pointing at it, which is exactly what intent_mispayments exists to
  // prevent.
  //
  // Reachable on both payment methods today, without the USDC flag: an intent
  // expires ten minutes after creation, and a payment made near that edge can
  // confirm after it. It becomes more reachable now that a stale tx_hash no
  // longer exempts a row from expiry forever, which is why the two land together.
  //
  // Still ok() rather than an error — the intent is untouched and there is
  // nothing for the watcher to retry — and still idempotent, since re-delivery
  // carries the same (txHash, logIndex) and de-duplicates on insert.
  if (intent.status === IntentStatus.EXPIRED) {
    logger.warn(
      'markIntentAsConfirmed: payment arrived for an expired intent — recording it',
      {
        intentId,
        expiresAt: intent.expiresAt,
        paymentMethod: intent.paymentMethod,
        txHash,
      },
    )
    await recordMispayment({
      intentId,
      reason: IntentMispaymentReason.INTENT_EXPIRED,
      expectedPaymentMethod: intent.paymentMethod ?? PaymentMethod.AI3_NATIVE,
      paymentAmount,
      tokenAmount,
      fromAddress,
      txHash,
      logIndex,
    })
    return ok(intent)
  }

  // The amount has to be denominated in the asset the intent was quoted in.
  //
  // Nothing upstream enforces this. payIntent(bytes32) on the AI3 receiver
  // accepts ANY intent id with any non-zero msg.value, and the watcher reports
  // every such event as `paymentAmount` regardless of what the intent expects. So
  // an AI3 payment against a USDC intent reaches here as a well-formed call.
  //
  // Confirming it anyway is what makes it dangerous. The row would go CONFIRMED
  // with payment_amount set and token_amount NULL, onConfirmedIntent would look
  // for the USDC column, find nothing, and the intent would sit in the 30-second
  // polling loop indefinitely — payment kept, no credits, and no terminal row for
  // an admin to find. Worse, the idempotency guard above would then treat the
  // intent as settled, so the user's real USDC payment would be silently
  // discarded when it arrived.
  //
  // Refusing writes no terminal status, leaving the intent PENDING so the user's
  // real payment can still settle it. Which sweep reclaims the row if none
  // arrives depends on whether it carries a tx_hash: without one the ordinary
  // expiry sweep takes it at expires_at, and with one — the case whenever the
  // mispayment arrived via POST /intents/:id/watch — the hash exempts it from
  // that sweep until intentTxGraceMinutes past the window. Either way it is
  // reclaimed. It used to be neither: a tx_hash exempted the row from expiry
  // permanently, so a refusal here left a row that could reach no terminal state
  // at all.
  //
  // The mispaid amount still needs manual resolution, so it is recorded in
  // intent_mispayments — refusing resolves nothing on chain, and an irreversible
  // transfer must not be left with only a log line pointing at it.
  const expectsToken = intent.paymentMethod === PaymentMethod.USDC_ETH
  const suppliedAmount = expectsToken ? tokenAmount : paymentAmount
  if (suppliedAmount === undefined) {
    logger.warn(
      'markIntentAsConfirmed: payment asset does not match the intent — refusing',
      {
        intentId,
        paymentMethod: intent.paymentMethod,
        gotPaymentAmount: paymentAmount?.toString(),
        gotTokenAmount: tokenAmount?.toString(),
        txHash,
      },
    )
    await recordMispayment({
      intentId,
      reason: IntentMispaymentReason.ASSET_MISMATCH,
      expectedPaymentMethod: intent.paymentMethod ?? PaymentMethod.AI3_NATIVE,
      paymentAmount,
      tokenAmount,
      fromAddress,
      txHash,
      logIndex,
    })
    return err(
      new BadRequestError(
        `Cannot confirm intent ${intentId}: it is denominated in ` +
          `${intent.paymentMethod ?? PaymentMethod.AI3_NATIVE} but the ` +
          `confirmation supplied ${expectsToken ? 'an AI3 paymentAmount' : 'a tokenAmount'}`,
      ),
    )
  }

  // Claim the intent. Conditional on it still being PENDING, because the status
  // read above is already stale by the time we get here: watchTransaction calls
  // this once per parsed log inside a Promise.all, so two payments for one intent
  // in a single transaction both pass the guard above before either writes. An
  // unconditional write let the second overwrite the first, crediting one amount
  // and losing the other with nothing filed either way.
  //
  // Also writes the transaction that settled the intent. Only POST
  // /intents/:id/watch used to write that column, so an intent confirmed by the
  // contract-event watcher had no record of which transaction paid it — and
  // without one, a later payment cannot be told apart from re-delivery of this
  // one by the guard above.
  const confirmed = await intentsRepository.confirmIntentIfPending({
    id: intentId,
    paymentAmount,
    tokenAmount,
    fromAddress,
    txHash,
  })

  // Lost the transition: something else moved the intent out of PENDING between
  // the read above and this write. Filed the same way as the guard above, reached
  // a different way. Nothing is retried and nothing is overwritten.
  if (!confirmed) {
    // Read the row back before naming a reason. Another payment winning the race
    // is the expected case, but it is not the only writer competing for PENDING:
    // expireIntentIfPending takes the same status, so a sweep firing in this
    // window leaves an intent that expired with nothing credited. Calling that
    // ALREADY_SETTLED would tell whoever works the queue there was a double
    // payment to reconcile, when in fact the money simply arrived too late — a
    // different situation with a different resolution.
    const current = await intentsRepository.getById(intentId)
    const reason =
      current?.status === IntentStatus.EXPIRED
        ? IntentMispaymentReason.INTENT_EXPIRED
        : IntentMispaymentReason.ALREADY_SETTLED

    logger.warn(
      'markIntentAsConfirmed: intent left PENDING before this payment could claim it — recording it',
      {
        intentId,
        currentStatus: current?.status,
        reason,
        received: (tokenAmount ?? paymentAmount)?.toString(),
        txHash,
        logIndex,
      },
    )
    await recordMispayment({
      intentId,
      reason,
      expectedPaymentMethod: intent.paymentMethod ?? PaymentMethod.AI3_NATIVE,
      paymentAmount,
      tokenAmount,
      fromAddress,
      txHash,
      logIndex,
    })
    return ok(current ?? intent)
  }

  // Settled at an amount that is not the amount quoted.
  //
  // Checked after the transition rather than before it, so a payment that lost
  // the race is filed once as ALREADY_SETTLED rather than also as an off-quote
  // settlement it never made.
  //
  // Not a refusal, and the grant is unchanged: conversion is proportional, so the
  // user receives storage worth exactly what they sent, at the rate they were
  // quoted at. That is the settlement rule on both payment methods and it needs no
  // human. But "handled" is not "unremarked". The API advertises quotedTokenAmount
  // as the exact amount to pay, locked until expiresAt, so a payment that differs
  // from it means the quote was missed — a stale UI, a hand-built contract call, a
  // wallet the user edited. Afterwards the row holds both numbers and no reader
  // compares them, so absent this the only signal is a balance the user has to
  // notice looks short, which is neither detectable nor recoverable by us.
  //
  // Recorded rather than refused because refusing is the strictly worse trade
  // here: it turns a self-resolving payment into an admin row and leaves a paying
  // user with no storage, and the queue it would land in has no grant path out.
  //
  // USDC only. An AI3 intent is quoted no amount at all — credits are
  // paymentAmount / shannonsPerByte for whatever arrives — so there is no promise
  // for a payment to deviate from.
  if (
    expectsToken &&
    intent.quotedTokenAmount !== undefined &&
    suppliedAmount !== intent.quotedTokenAmount
  ) {
    logger.warn(
      'markIntentAsConfirmed: payment differs from the locked quote — crediting it proportionally',
      {
        intentId,
        quotedTokenAmount: intent.quotedTokenAmount.toString(),
        received: suppliedAmount.toString(),
        txHash,
      },
    )
    await recordMispayment({
      intentId,
      reason: IntentMispaymentReason.AMOUNT_OFF_QUOTE,
      expectedPaymentMethod: PaymentMethod.USDC_ETH,
      paymentAmount,
      tokenAmount,
      fromAddress,
      txHash,
      logIndex,
    })
  }

  return ok(confirmed)
}

/**
 * Bytes of storage a confirmed payment buys.
 *
 * Both paths are the same idea — convert what was received into AI3, then divide
 * by the price per byte locked at creation. They differ only in what "convert"
 * means, because an AI3 payment already IS AI3 and a USDC payment has to be
 * converted at the rate the user was quoted.
 *
 * That rate is `quotedTokenAmount / quotedAi3Shannons`, held as the pair rather
 * than as a stored ratio so the conversion is exact. It is emphatically NOT
 * `usdRateAtCreation`: that is the raw rate the oracle reported — a
 * volume-weighted average of the pool's realized fills — while the user paid
 * that rate plus USD_QUOTE_MARGIN. Since #807 the margin is the entire wedge
 * between the two (the swap fee and price impact are inside the rate, paid by
 * the fills it averages), so converting at the raw rate hands the whole margin
 * back as free storage and grants more bytes than the pre-payment cap check
 * allowed for.
 *
 * Multiplication before division throughout, so no intermediate floors. Paying
 * exactly `quotedTokenAmount` makes the first division exact
 * (quotedTokenAmount * quotedAi3Shannons / quotedTokenAmount), leaving
 * quotedAi3Shannons, and since that was requestedBytes * shannonsPerByte the
 * second division is exact too. The user receives exactly the size they were
 * quoted — no rounding in either direction. There is a regression test pinning
 * this.
 */
const getIntentCredits = (intent: Intent): bigint => {
  // Both branches divide by it, and BigInt division by zero throws rather than
  // returning a Result — which would escape onConfirmedIntent as an exception and
  // abort the whole _checkConfirmedIntents tick, not just this intent. Reporting
  // 0 routes the row to FAILED for admin review and leaves the rest of the batch
  // alone. Reachable via a misconfigured CREDITS_PRICE_MULTIPLIER=0 or a zero
  // byte fee at creation.
  if (intent.shannonsPerByte === 0n) {
    return BigInt(0)
  }

  if (intent.paymentMethod === PaymentMethod.USDC_ETH) {
    // A USDC intent without all three is not convertible. Returning 0 routes it
    // to the FAILED branch in onConfirmedIntent for admin review, rather than
    // guessing at a rate and granting the wrong amount.
    if (
      !intent.tokenAmount ||
      !intent.quotedTokenAmount ||
      !intent.quotedAi3Shannons
    ) {
      return BigInt(0)
    }

    const shannons =
      (intent.tokenAmount * intent.quotedAi3Shannons) / intent.quotedTokenAmount

    return shannons / intent.shannonsPerByte
  }

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

  // Which column carries "what was received" depends on the asset: shannons in
  // paymentAmount for AI3, token base units in tokenAmount for USDC.
  const receivedAmount =
    intent.paymentMethod === PaymentMethod.USDC_ETH
      ? intent.tokenAmount
      : intent.paymentAmount

  // Terminal, not a retry. A CONFIRMED intent whose received-amount column is
  // empty can never fill it in — nothing writes that column after confirmation —
  // so returning an error just re-runs this every 30 seconds forever, keeping the
  // payment with no credits granted and nothing in the admin queue to find.
  // FAILED stops the loop and surfaces the row, which is how every other
  // unresolvable confirmation in this function is handled.
  //
  // markIntentAsConfirmed now refuses a mismatched asset, so this is
  // defence-in-depth for rows written before that check existed.
  //
  // Filed for the same reason the zero-credit branch below files: FAILED is
  // terminal and has no listing of its own, so an intent that reaches it is not
  // something an admin finds. There is less to go on here than there — no amount,
  // by definition — but the intent id and the transaction are enough to look up
  // what arrived, and that beats a log line. Recorded before the status write so a
  // failed update cannot lose both.
  //
  // Compared against undefined rather than falsy on purpose. A zero amount is a
  // different thing from a missing one, and belongs to the zero-credit branch
  // below, which files it with the amount attached rather than reporting it as
  // absent. Neither receiver can emit a zero — both revert on it — so this is
  // about the branch meaning what it says, not a reachable case.
  if (receivedAmount === undefined) {
    logger.warn(
      'onConfirmedIntent: confirmed intent has no deposit amount — marking FAILED',
      {
        intentId,
        paymentMethod: intent.paymentMethod,
      },
    )
    await recordMispayment({
      intentId,
      reason: IntentMispaymentReason.UNCONVERTIBLE_PAYMENT,
      expectedPaymentMethod: intent.paymentMethod ?? PaymentMethod.AI3_NATIVE,
      paymentAmount: intent.paymentAmount,
      tokenAmount: intent.tokenAmount,
      fromAddress: intent.fromAddress,
      txHash: intent.txHash,
    })
    await intentsRepository.updateIntent({
      ...intent,
      status: IntentStatus.FAILED,
    })
    return ok()
  }

  // Guard: reject payments whose value is too small to purchase even a single
  // byte of storage.  getIntentCredits divides down to bytes using BigInt
  // integer division, so a dust payment yields 0 credits.  Granting 0 credits
  // would mark the intent COMPLETED while giving the user nothing — a misleading
  // outcome that wastes a DB row and silently discards the payment.
  //
  // On the USDC path this also catches an intent that has a tokenAmount but is
  // missing one of the other two conversion inputs, which getIntentCredits
  // reports as 0 rather than guessing at a rate. A missing tokenAmount is caught
  // by the guard above instead, since there is no received amount to reason about
  // at all.
  //
  // Every input is immutable on a confirmed intent, so this condition is
  // permanent.  We mark the intent FAILED (terminal) so the polling loop stops
  // retrying.  The on-chain payment is irreversible; resolution requires admin
  // review (similar to OVER_CAP handling).
  const creditBytes = IntentsUseCases.getIntentCredits(intent)
  if (creditBytes === BigInt(0)) {
    logger.warn(
      'onConfirmedIntent: payment too small to yield any credits — marking FAILED',
      {
        intentId,
        paymentMethod: intent.paymentMethod,
        receivedAmount: receivedAmount.toString(),
        quotedTokenAmount: intent.quotedTokenAmount?.toString(),
        quotedAi3Shannons: intent.quotedAi3Shannons?.toString(),
        shannonsPerByte: intent.shannonsPerByte.toString(),
      },
    )
    // FAILED is terminal and no listing surfaces a FAILED intent, so the row
    // itself is not something an admin finds — unlike OVER_CAP, which has both an
    // endpoint and a reprocess path. The payment is real and kept, so it is filed
    // like any other on-chain money we cannot attach.
    //
    // Filed before the status write, so a failed update leaves the money on
    // record rather than losing both. No log index is available here — this runs
    // from the stored row, not from the event — so the row cannot de-duplicate;
    // it does not need to, because reaching FAILED takes the intent out of
    // getConfirmedIntents and nothing puts it back.
    await recordMispayment({
      intentId,
      reason: IntentMispaymentReason.UNCONVERTIBLE_PAYMENT,
      expectedPaymentMethod: intent.paymentMethod ?? PaymentMethod.AI3_NATIVE,
      paymentAmount: intent.paymentAmount,
      tokenAmount: intent.tokenAmount,
      fromAddress: intent.fromAddress,
      txHash: intent.txHash,
    })
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
        paymentMethod: intent.paymentMethod,
        receivedAmount: receivedAmount.toString(),
        creditBytes: creditBytes.toString(),
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

// Returns on-chain payments written down for admin review: money that arrived and
// that no other listing would show.
//
// Mostly refusals — a payment naming an unknown intent, denominated in the other
// asset, arriving after the price lock lapsed, or landing on an intent another
// transfer already settled. Those are the least visible thing that can happen to
// money here, because the intent they name is untouched and nothing about its row
// says a payment arrived at all. UNCONVERTIBLE_PAYMENT is a payment we did accept
// and could not turn into a single byte; its intent is FAILED, which is terminal
// and has no listing of its own. OVER_CAP is the one case that stays out of this
// table entirely, having both an endpoint and a way back.
//
// AMOUNT_OFF_QUOTE is the one reason here that needs nothing done: those payments
// were credited normally, and the row exists only because no other one records
// that the amount paid differed from the amount quoted. Filter on `reason` before
// working the list as a queue.
const getMispayments = async (executor: User) => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }
  return ok(await intentMispaymentsRepository.list())
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
  const expired = await intentsRepository.getExpiredPendingIntents(
    config.credits.intentTxGraceMinutes,
  )
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
const getPendingWithTxHash = async (
  paymentMethod: PaymentMethod,
): Promise<Intent[]> => {
  return intentsRepository.getPendingWithTxHash(paymentMethod)
}

export const IntentsUseCases = {
  createIntent,
  parseRequestedBytes,
  parsePaymentMethod,
  getIntent,
  updateIntent,
  triggerWatchIntent,
  onConfirmedIntent,
  markIntentAsConfirmed,
  getConfirmedIntents,
  getOverCapIntents,
  getMispayments,
  getPendingWithTxHash,
  reprocessOverCapIntent,
  getIntentCredits,
  getPrice,
  cleanupExpiredIntents,
}
