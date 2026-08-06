import {
  Intent,
  IntentStatus,
  PaymentMethod,
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
  QuoteErrorCode,
  QuoteFailedError,
  ServiceUnavailableError,
} from '../../errors/index.js'
import { err, ok, Result } from 'neverthrow'
import { config } from '../../config.js'
import { randomBytes } from 'crypto'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { AccountsUseCases } from './accounts.js'
import { transactionByteFee } from '@autonomys/auto-consensus'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { priceOracle } from '../../infrastructure/services/priceOracle/index.js'
import {
  InvalidQuoteAmountError,
  PriceDeviationError,
  QuoteTooLargeError,
} from '../../infrastructure/services/priceOracle/types.js'
import { applyMarginPercent } from '../../shared/utils/index.js'

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

// Map a price-oracle failure onto an HTTP status and a client-facing code.
//
// The oracle separates four causes on purpose; collapsing them into one status
// throws that away and misdirects the user. Two are ours and retryable, two are
// about the size that was asked for:
//
//   OracleUnavailableError  503  we could not get a trustworthy price — retry
//   PriceDeviationError     503  the pool is not stable enough to quote — retry
//   QuoteTooLargeError      409  the pool cannot fill it — ask for less
//   InvalidQuoteAmountError 400  the amount is unquotable — below the minimum,
//                                or out of the quoter's range
//
// QuoteTooLargeError is 409 rather than 400: the request is well-formed and was
// valid for a smaller size or a deeper pool, which is a state conflict rather
// than a malformed input.
const quoteErrorToHttpError = (
  error:
    | InvalidQuoteAmountError
    | PriceDeviationError
    | QuoteTooLargeError
    | Error,
): QuoteFailedError => {
  if (error instanceof QuoteTooLargeError) {
    return new QuoteFailedError(
      ConflictError.statusCode,
      QuoteErrorCode.QUOTE_TOO_LARGE,
      error.message,
    )
  }
  if (error instanceof InvalidQuoteAmountError) {
    return new QuoteFailedError(
      BadRequestError.statusCode,
      QuoteErrorCode.AMOUNT_INVALID,
      error.message,
    )
  }
  if (error instanceof PriceDeviationError) {
    return new QuoteFailedError(
      ServiceUnavailableError.statusCode,
      QuoteErrorCode.PRICE_UNSTABLE,
      error.message,
    )
  }
  // OracleUnavailableError, and anything the oracle grows later: an unrecognised
  // failure is our problem and retryable, which is the safe default. It must not
  // fall through to a 4xx and tell the user to change a request that was fine.
  return new QuoteFailedError(
    ServiceUnavailableError.statusCode,
    QuoteErrorCode.ORACLE_UNAVAILABLE,
    error.message,
  )
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
  { requestedBytes, paymentMethod = PaymentMethod.AI3_NATIVE }: CreateIntentOptions = {},
): Promise<
  Result<Intent, BadRequestError | CreditCapExceededError | QuoteFailedError>
> => {
  // A USDC intent is a fixed-price quote for a specific size, so there is nothing
  // to quote without one. Checked here rather than in parseRequestedBytes because
  // a caller reaching this use case directly must be held to the same rule — the
  // parser's job ends at the wire shape.
  if (paymentMethod === PaymentMethod.USDC_ETH && requestedBytes === undefined) {
    return err(
      new BadRequestError(
        'requestedBytes is required when paying with USDC: the amount charged ' +
          'is a quote for a specific purchase size',
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
  // Quote the AI3 the purchase is worth, not the bytes: the pool prices AI3, and
  // shannonsPerByte is what ties the two together. Locking both numbers on the
  // same intent is what makes the charge reproducible.
  const quotedAi3Shannons = requestedBytes! * shannonsPerByte

  const quote = await priceOracle.getExecutableQuote(quotedAi3Shannons)
  if (quote.isErr()) {
    logger.info('Rejecting USDC intent creation — could not quote the purchase', {
      userPublicId: executor.publicId,
      requestedBytes: requestedBytes!.toString(),
      quotedAi3Shannons: quotedAi3Shannons.toString(),
      error: quote.error.name,
      message: quote.error.message,
    })
    return err(quoteErrorToHttpError(quote.error))
  }

  // The margin goes on the EXECUTABLE quote, not on the marginal value. The
  // executable quote already covers the swap fee and this size's own price
  // impact at quote time; the margin covers what it cannot — drift between
  // quoting now and converting later, while the 10-minute price lock is open.
  // Reasoning lives in pricing.ts; do not re-derive it here.
  const quotedTokenAmount = applyMarginPercent(
    quote.value.usdcAmount,
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
    // Marginal spot price, for display and oracle reconciliation only. NEVER
    // convert a payment at this rate: it excludes the fee, the impact and the
    // margin the user actually paid, so doing so grants 5-8% free storage.
    usdRateAtCreation: quote.value.usdPerAi3,
    expiresAt,
  })

  logger.info('Created USDC intent with a locked quote', {
    intentId: intent.id,
    userPublicId: executor.publicId,
    requestedBytes: requestedBytes!.toString(),
    quotedAi3Shannons: quotedAi3Shannons.toString(),
    quotedTokenAmount: quotedTokenAmount.toString(),
    priceImpactBps: quote.value.priceImpactBps.toString(),
    quotePremiumBps: quote.value.quotePremiumBps.toString(),
    blockNumber: quote.value.blockNumber.toString(),
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
  tokenAmount,
  fromAddress,
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
  // Refusing leaves the intent PENDING so it expires on its own schedule. The
  // mispaid amount still needs manual resolution, which is the same position a
  // payment to an unknown intent id is already in.
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
      },
    )
    return err(
      new BadRequestError(
        `Cannot confirm intent ${intentId}: it is denominated in ` +
          `${intent.paymentMethod ?? PaymentMethod.AI3_NATIVE} but the ` +
          `confirmation supplied ${expectsToken ? 'an AI3 paymentAmount' : 'a tokenAmount'}`,
      ),
    )
  }

  return ok(
    await intentsRepository.updateIntent({
      ...intent,
      status: IntentStatus.CONFIRMED,
      paymentAmount: paymentAmount ?? intent.paymentAmount,
      tokenAmount: tokenAmount ?? intent.tokenAmount,
      fromAddress: fromAddress ?? intent.fromAddress,
    }),
  )
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
 * `usdRateAtCreation`: that is the pool's marginal price, while the user paid the
 * executable quote plus the margin. Converting at the marginal rate refunds the
 * swap fee, the price impact and the margin as free storage — 5-8% on a realistic
 * purchase — and grants more bytes than the pre-payment cap check allowed for.
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
  if (!receivedAmount) {
    logger.warn(
      'onConfirmedIntent: confirmed intent has no deposit amount — marking FAILED',
      {
        intentId,
        paymentMethod: intent.paymentMethod,
      },
    )
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
  parsePaymentMethod,
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
