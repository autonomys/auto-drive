import { jest } from '@jest/globals'
import { IntentsUseCases } from '../../../src/core/users/intents.js'
import { intentsRepository } from '../../../src/infrastructure/repositories/users/intents.js'
import { purchasedCreditsRepository } from '../../../src/infrastructure/repositories/users/purchasedCredits.js'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { config } from '../../../src/config.js'
import {
  BadRequestError,
  ConflictError,
  CreditCapExceededError,
  ForbiddenError,
  GoneError,
  QuoteErrorCode,
  QuoteFailedError,
} from '../../../src/errors/index.js'
import {
  IntentStatus,
  PaymentMethod,
  UserRole,
  type Account,
  type Intent,
  type PurchasedCreditSummary,
  type User,
  type UserWithOrganization,
} from '@auto-drive/models'
import { ok, err } from 'neverthrow'
import { priceOracle } from '../../../src/infrastructure/services/priceOracle/index.js'
import {
  InvalidQuoteAmountError,
  OracleUnavailableError,
  PriceDeviationError,
  QuoteTooLargeError,
  type ExecutableQuote,
} from '../../../src/infrastructure/services/priceOracle/types.js'
import {
  ai3ShannonsToUsdcBaseUnits,
  applyMarginPercent,
} from '../../../src/shared/utils/index.js'

describe('IntentsUseCases', () => {
  const now = new Date()
  const user: User = {
    id: 'user-id',
    publicId: 'pub-1',
    walletAddress: '0xabc',
    createdAt: now,
    updatedAt: now,
    authProvider: 'github',
    organizationId: 'org-1',
  } as unknown as User

  // createIntent needs the organization to resolve an account for the cap
  // pre-check; handleAuth already hands the controller this shape.
  const orgUser = user as unknown as UserWithOrganization

  const cap = config.credits.maxBytesPerUser

  // Point the cap pre-check at a given already-purchased balance.
  const mockPurchasedBalance = (uploadBytesRemaining: bigint) => {
    jest
      .spyOn(AccountsUseCases, 'getOrCreateAccount')
      .mockResolvedValue({ id: 'acc-1' } as unknown as Account)
    return jest
      .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
      .mockResolvedValue({
        uploadBytesRemaining,
        uploadBytesOriginal: uploadBytesRemaining,
        downloadBytesRemaining: 0n,
        nextExpiryDate: null,
        activeRowCount: 1,
      } as PurchasedCreditSummary)
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(IntentsUseCases, 'getPrice').mockResolvedValue({ price: 1, pricePerGB: 1073741824 })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ────────────────────────────────────────────────────────────────────────────
  // createIntent
  // ────────────────────────────────────────────────────────────────────────────

  it('createIntent should create PENDING intent for user', async () => {
    jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const result = await IntentsUseCases.createIntent(orgUser)

    expect(result.isOk()).toBe(true)
    const intent = result._unsafeUnwrap()
    expect(intent.userPublicId).toBe(user.publicId)
    expect(intent.status).toBe(IntentStatus.PENDING)
    expect(intent.shannonsPerByte).toBe(1n)
  })

  it('createIntent should set expiresAt in the future', async () => {
    jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const before = new Date()
    const result = await IntentsUseCases.createIntent(orgUser)
    const after = new Date()

    const intent = result._unsafeUnwrap()
    expect(intent.expiresAt).toBeDefined()
    expect(intent.expiresAt!.getTime()).toBeGreaterThan(before.getTime())
    // expiresAt should be at least 1 minute ahead (config default is 10 min)
    expect(intent.expiresAt!.getTime()).toBeGreaterThan(
      before.getTime() + 60 * 1000,
    )
    expect(intent.expiresAt!.getTime()).toBeLessThan(
      after.getTime() + 15 * 60 * 1000,
    )
  })

  // ────────────────────────────────────────────────────────────────────────────
  // createIntent — requestedBytes
  //
  // The regression that matters most in this group is the first test: the live
  // frontend posts no body, and that path must stay byte-for-byte what it was.
  // ────────────────────────────────────────────────────────────────────────────

  it('createIntent without requestedBytes runs no cap pre-check', async () => {
    jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)
    const accountSpy = jest.spyOn(AccountsUseCases, 'getOrCreateAccount')
    const balanceSpy = jest.spyOn(
      purchasedCreditsRepository,
      'getRemainingCredits',
    )

    const result = await IntentsUseCases.createIntent(orgUser)

    expect(result.isOk()).toBe(true)
    // No size given means nothing to check — the balance must not even be read.
    expect(accountSpy).not.toHaveBeenCalled()
    expect(balanceSpy).not.toHaveBeenCalled()
  })

  it('createIntent does not persist requestedBytes on the intent', async () => {
    mockPurchasedBalance(0n)
    const createSpy = jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 1_073_741_824n,
    })

    expect(result.isOk()).toBe(true)
    // On the AI3 path the size gates creation and is then discarded. Persisting
    // it would store a number that reads like a balance and never agrees with
    // one, since credits come from paymentAmount / shannonsPerByte.
    //
    // The USDC path is different and deliberately so: it persists
    // quotedAi3Shannons, which is the size times the locked price and therefore
    // half of the rate the payment converts at. See the USDC group below.
    const created = createSpy.mock.calls[0][0]
    expect(Object.keys(created)).not.toContain('quotedBytes')
    expect(created.quotedAi3Shannons).toBeUndefined()
    expect(created.quotedTokenAmount).toBeUndefined()
  })

  it.each<[string, bigint]>([
    ['zero', 0n],
    ['negative', -1n],
  ])(
    'createIntent rejects a %s requestedBytes without pricing or reading the balance',
    async (_label, requestedBytes) => {
      const priceSpy = jest.spyOn(IntentsUseCases, 'getPrice')
      const balanceSpy = jest.spyOn(
        purchasedCreditsRepository,
        'getRemainingCredits',
      )
      const createSpy = jest.spyOn(intentsRepository, 'createIntent')

      const result = await IntentsUseCases.createIntent(orgUser, {
        requestedBytes,
      })

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
      expect(priceSpy).not.toHaveBeenCalled()
      expect(balanceSpy).not.toHaveBeenCalled()
      expect(createSpy).not.toHaveBeenCalled()
    },
  )

  it('createIntent rejects a requestedBytes above the per-user cap as a bad request', async () => {
    const priceSpy = jest.spyOn(IntentsUseCases, 'getPrice')
    const balanceSpy = jest.spyOn(
      purchasedCreditsRepository,
      'getRemainingCredits',
    )

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: cap + 1n,
    })

    expect(result.isErr()).toBe(true)
    // A size that can never fit is malformed, not a headroom problem — and it
    // must not cost a balance read to find out.
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(result._unsafeUnwrapErr()).not.toBeInstanceOf(CreditCapExceededError)
    expect(balanceSpy).not.toHaveBeenCalled()
    expect(priceSpy).not.toHaveBeenCalled()
  })

  it('createIntent rejects with CREDIT_CAP_EXCEEDED when the existing balance leaves no room', async () => {
    mockPurchasedBalance(cap - 100n)
    const priceSpy = jest.spyOn(IntentsUseCases, 'getPrice')
    const createSpy = jest.spyOn(intentsRepository, 'createIntent')

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 101n,
    })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(CreditCapExceededError)
    expect(error).toBeInstanceOf(ForbiddenError)
    // The message has to tell a caller how much room is actually left.
    expect(error.message).toContain(cap.toString())
    expect(error.message).toContain((cap - 100n).toString())
    // Rejected before pricing, and before any intent row exists.
    expect(priceSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('createIntent accepts a purchase that lands exactly on the cap', async () => {
    mockPurchasedBalance(cap - 100n)
    jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 100n,
    })

    // Boundary must match the authoritative check in
    // createPurchasedCreditWithCapCheck, which uses `>`. A stricter pre-check
    // here would refuse purchases the real check would have granted.
    expect(result.isOk()).toBe(true)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // createIntent — USDC quoting
  // ────────────────────────────────────────────────────────────────────────────

  // A quote the oracle would plausibly return. usdcAmount is deliberately NOT
  // the marginal value of ai3Shannons at usdPerAi3 — the gap between them (fee +
  // price impact) is exactly what must not leak back to the user as free bytes.
  const stubQuote = (overrides: Partial<ExecutableQuote> = {}) => ({
    usdcAmount: 1_000_000n,
    usdPerAi3: 6_400_000_000_000_000n,
    priceImpactBps: 12n,
    quotePremiumBps: 42n,
    ai3Shannons: 0n,
    blockNumber: 21_000_000n,
    asOf: new Date(),
    ...overrides,
  })

  const mockQuote = (overrides: Partial<ExecutableQuote> = {}) =>
    jest
      .spyOn(priceOracle, 'getExecutableQuote')
      .mockResolvedValue(ok(stubQuote(overrides) as ExecutableQuote))

  it('createIntent requires requestedBytes when paying with USDC', async () => {
    const quoteSpy = jest.spyOn(priceOracle, 'getExecutableQuote')
    const priceSpy = jest.spyOn(IntentsUseCases, 'getPrice')
    const createSpy = jest.spyOn(intentsRepository, 'createIntent')

    const result = await IntentsUseCases.createIntent(orgUser, {
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    // Nothing may be priced, quoted or written without a size to quote for.
    expect(priceSpy).not.toHaveBeenCalled()
    expect(quoteSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('createIntent quotes the AI3 value of the purchase, not the byte count', async () => {
    mockPurchasedBalance(0n)
    const quoteSpy = mockQuote()
    jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)
    // shannonsPerByte = 3 for this test, so the AI3 handed to the pool is
    // 1000 bytes * 3 = 3000 shannons.
    jest
      .spyOn(IntentsUseCases, 'getPrice')
      .mockResolvedValue({ price: 3, pricePerGB: 1 })

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 1000n,
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    expect(result.isOk()).toBe(true)
    expect(quoteSpy).toHaveBeenCalledWith(3000n)
  })

  it('createIntent persists the charge, what it was charged for, and the marginal rate', async () => {
    mockPurchasedBalance(0n)
    mockQuote({ usdcAmount: 1_000_000n, usdPerAi3: 6_400_000_000_000_000n })
    const createSpy = jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 1000n,
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    expect(result.isOk()).toBe(true)
    const created = createSpy.mock.calls[0][0]
    expect(created.paymentMethod).toBe(PaymentMethod.USDC_ETH)
    // shannonsPerByte is 1 from the default getPrice mock.
    expect(created.quotedAi3Shannons).toBe(1000n)
    // The margin goes on the executable quote. Default USD_QUOTE_MARGIN is 5%,
    // so 1_000_000 becomes 1_050_000.
    expect(created.quotedTokenAmount).toBe(
      applyMarginPercent(1_000_000n, config.credits.usdQuoteMarginPercent),
    )
    // The stored rate stays the raw marginal price — it is display and
    // reconciliation data, never the conversion rate.
    expect(created.usdRateAtCreation).toBe(6_400_000_000_000_000n)
  })

  it('createIntent does not quote until the cap pre-check has passed', async () => {
    mockPurchasedBalance(cap - 100n)
    const quoteSpy = jest.spyOn(priceOracle, 'getExecutableQuote')
    const createSpy = jest.spyOn(intentsRepository, 'createIntent')

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 101n,
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(CreditCapExceededError)
    // An Ethereum round-trip is not spent on a purchase that cannot be granted.
    expect(quoteSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  // The taxonomy exists so an outage on our side is not reported to the user as
  // a problem with what they asked for. A generic 500 would waste it.
  it.each<[string, Error, number, QuoteErrorCode]>([
    [
      'an unreachable oracle',
      new OracleUnavailableError('pool could not be quoted'),
      503,
      QuoteErrorCode.ORACLE_UNAVAILABLE,
    ],
    [
      'an untrustworthy pool price',
      new PriceDeviationError('spot deviates from the quote block', 750n),
      503,
      QuoteErrorCode.PRICE_UNSTABLE,
    ],
    [
      'a size the pool cannot fill',
      new QuoteTooLargeError('pool cannot fill it'),
      409,
      QuoteErrorCode.QUOTE_TOO_LARGE,
    ],
    [
      'an unquotable amount',
      new InvalidQuoteAmountError('below the minimum'),
      400,
      QuoteErrorCode.AMOUNT_INVALID,
    ],
  ])(
    'createIntent maps %s to the right status and code',
    async (_label, oracleError, expectedStatus, expectedCode) => {
      mockPurchasedBalance(0n)
      jest
        .spyOn(priceOracle, 'getExecutableQuote')
        .mockResolvedValue(err(oracleError as never))
      const createSpy = jest.spyOn(intentsRepository, 'createIntent')

      const result = await IntentsUseCases.createIntent(orgUser, {
        requestedBytes: 1000n,
        paymentMethod: PaymentMethod.USDC_ETH,
      })

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(QuoteFailedError)
      expect((error as QuoteFailedError).statusCode).toBe(expectedStatus)
      expect((error as QuoteFailedError).code).toBe(expectedCode)
      // A failed quote must not leave a PENDING intent with no price behind.
      expect(createSpy).not.toHaveBeenCalled()
    },
  )

  it('createIntent treats an unrecognised quote failure as retryable, not as bad input', async () => {
    mockPurchasedBalance(0n)
    jest
      .spyOn(priceOracle, 'getExecutableQuote')
      .mockResolvedValue(err(new Error('something new') as never))

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 1000n,
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    const error = result._unsafeUnwrapErr() as QuoteFailedError
    // Defaulting to 4xx would tell a user to change a request that was fine.
    expect(error.statusCode).toBe(503)
    expect(error.code).toBe(QuoteErrorCode.ORACLE_UNAVAILABLE)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // The invariant this whole design exists to protect
  // ────────────────────────────────────────────────────────────────────────────

  it('paying exactly the quoted USDC amount grants exactly the requested bytes', async () => {
    const requestedBytes = 1_073_741_824n // 1 GiB
    const shannonsPerByte = 422_005_541_622n // realistic, from a $290/100GiB pool
    mockPurchasedBalance(0n)
    jest
      .spyOn(IntentsUseCases, 'getPrice')
      .mockResolvedValue({ price: Number(shannonsPerByte), pricePerGB: 1 })
    // A quote with a real fee-and-impact gap over the marginal value, which is
    // what makes converting at usdRateAtCreation wrong.
    mockQuote({ usdcAmount: 2_900_000_000n, usdPerAi3: 6_400_000_000_000_000n })
    const createSpy = jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const created = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes,
      paymentMethod: PaymentMethod.USDC_ETH,
    })
    expect(created.isOk()).toBe(true)
    const intent = createSpy.mock.calls[0][0]

    // The user pays precisely what they were quoted.
    const credits = IntentsUseCases.getIntentCredits({
      ...intent,
      tokenAmount: intent.quotedTokenAmount,
    })

    // Exactly — not "close to". Any rounding here is money.
    expect(credits).toBe(requestedBytes)
  })

  it('converting at the marginal rate would over-credit — the regression this guards', () => {
    const requestedBytes = 1_073_741_824n
    const shannonsPerByte = 422_005_541_622n
    const quotedAi3Shannons = requestedBytes * shannonsPerByte
    const usdPerAi3 = 6_400_000_000_000_000n
    // Executable cost sits above the marginal value by fee + impact, then the
    // margin goes on top.
    const marginal = ai3ShannonsToUsdcBaseUnits(quotedAi3Shannons, usdPerAi3)
    const quotedTokenAmount = applyMarginPercent(
      (marginal * 1015n) / 1000n, // +1.5% fee and impact
      config.credits.usdQuoteMarginPercent,
    )

    const intent: Intent = {
      id: '0xusdc-drift',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      shannonsPerByte,
      paymentMethod: PaymentMethod.USDC_ETH,
      quotedTokenAmount,
      quotedAi3Shannons,
      usdRateAtCreation: usdPerAi3,
      tokenAmount: quotedTokenAmount,
    }

    // Correct: the rate the user was actually charged at.
    expect(IntentsUseCases.getIntentCredits(intent)).toBe(requestedBytes)

    // Wrong, and this is the ~6.5% the epic keeps warning about: converting the
    // same payment at the marginal spot rate.
    const viaMarginalRate =
      (quotedTokenAmount * 10n ** 30n) / usdPerAi3 / shannonsPerByte
    expect(viaMarginalRate).toBeGreaterThan(requestedBytes)
    const overCreditBps =
      ((viaMarginalRate - requestedBytes) * 10_000n) / requestedBytes
    expect(overCreditBps).toBeGreaterThan(600n) // >6%
  })

  it('getIntentCredits returns 0 for a USDC intent missing any conversion input', () => {
    const base: Intent = {
      id: '0xusdc-partial',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      tokenAmount: 1_050_000n,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
    }

    // Guessing at a rate would grant the wrong amount silently; 0 routes the
    // intent to FAILED for admin review instead.
    expect(
      IntentsUseCases.getIntentCredits({ ...base, tokenAmount: undefined }),
    ).toBe(0n)
    expect(
      IntentsUseCases.getIntentCredits({
        ...base,
        quotedTokenAmount: undefined,
      }),
    ).toBe(0n)
    expect(
      IntentsUseCases.getIntentCredits({
        ...base,
        quotedAi3Shannons: undefined,
      }),
    ).toBe(0n)
  })

  it('onConfirmedIntent grants credits for a USDC intent from tokenAmount', async () => {
    const intent: Intent = {
      id: '0xusdc-confirm',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      shannonsPerByte: 2n,
      paymentMethod: PaymentMethod.USDC_ETH,
      // 1000 shannons quoted for 1_050_000 base units; paying that exactly
      // yields 1000 shannons, and at 2 shannons/byte that is 500 bytes.
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
      tokenAmount: 1_050_000n,
      // No paymentAmount at all — the AI3 column stays NULL on this path.
      paymentAmount: undefined,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const addCreditsSpy = jest
      .spyOn(AccountsUseCases, 'addCreditsToAccount')
      .mockResolvedValue(ok())
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.COMPLETED })

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    expect(res.isOk()).toBe(true)
    // The old guard read paymentAmount unconditionally and would have refused
    // this intent as having no deposit.
    expect(addCreditsSpy).toHaveBeenCalledWith(user.publicId, 500n, intent.id)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: IntentStatus.COMPLETED }),
    )
  })

  it('markIntentAsConfirmed records a USDC payment on tokenAmount, not paymentAmount', async () => {
    const intent: Intent = {
      id: '0xusdc-mark',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockImplementation(async (i) => i)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      tokenAmount: 1_050_000n,
      fromAddress: '0xpayer',
    })

    expect(res.isOk()).toBe(true)
    const updated = updateSpy.mock.calls[0][0]
    expect(updated.tokenAmount).toBe(1_050_000n)
    // paymentAmount is denominated in shannons; writing USDC into it would make
    // every AI3-shaped read of the row wrong.
    expect(updated.paymentAmount).toBeUndefined()
    // The quote must survive the status transition — updateIntent rewrites the
    // whole column list, so a column missing from it is silently nulled here.
    expect(updated.quotedTokenAmount).toBe(1_050_000n)
    expect(updated.quotedAi3Shannons).toBe(1000n)
  })

  it('markIntentAsConfirmed refuses a confirmation carrying no amount at all', async () => {
    const getByIdSpy = jest.spyOn(intentsRepository, 'getById')

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: '0xnothing',
    })

    expect(res.isErr()).toBe(true)
    expect(res._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    // Refused before the row is even read — confirming with nothing received
    // would surface later as a 0-credit FAILED row to diagnose backwards.
    expect(getByIdSpy).not.toHaveBeenCalled()
  })

  // ────────────────────────────────────────────────────────────────────────────
  // parsePaymentMethod
  // ────────────────────────────────────────────────────────────────────────────

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
  ])('parsePaymentMethod defaults %s to AI3 (body-less requests)', (_l, raw) => {
    const result = IntentsUseCases.parsePaymentMethod(raw)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe(PaymentMethod.AI3_NATIVE)
  })

  it.each<[PaymentMethod]>([
    [PaymentMethod.AI3_NATIVE],
    [PaymentMethod.USDC_ETH],
  ])('parsePaymentMethod accepts %s', (method) => {
    const result = IntentsUseCases.parsePaymentMethod(method)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe(method)
  })

  it.each<[string, unknown]>([
    ['a near-miss casing', 'USDC_ETH'],
    ['a shorthand', 'usdc'],
    ['an unknown asset', 'eth_native'],
    ['an empty string', ''],
    ['a number', 1],
    ['an object', { paymentMethod: 'usdc_eth' }],
  ])('parsePaymentMethod rejects %s rather than defaulting to AI3', (_l, raw) => {
    // Defaulting would quote in AI3 a purchase the caller intended to pay in
    // USDC, and they would only find out at payment time.
    const result = IntentsUseCases.parsePaymentMethod(raw)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // parseRequestedBytes
  // ────────────────────────────────────────────────────────────────────────────

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
  ])('parseRequestedBytes treats %s as no size given', (_label, raw) => {
    const result = IntentsUseCases.parseRequestedBytes(raw)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeUndefined()
  })

  it.each<[string, unknown, bigint]>([
    ['a decimal string', '1073741824', 1_073_741_824n],
    ['a zero string', '0', 0n],
    ['a safe-integer number', 1_073_741_824, 1_073_741_824n],
    ['a bigint', 1_073_741_824n, 1_073_741_824n],
  ])('parseRequestedBytes accepts %s', (_label, raw, expected) => {
    const result = IntentsUseCases.parseRequestedBytes(raw)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe(expected)
  })

  it.each<[string, unknown]>([
    ['a fractional string', '1.5'],
    ['a fractional number', 1.5],
    ['exponential notation', '1e9'],
    ['a hex string', '0x10'],
    ['an empty string', ''],
    ['whitespace', ' 10 '],
    ['a signed string', '+10'],
    ['a non-numeric string', 'lots'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a number beyond safe-integer range', 2 ** 53],
    ['a boolean', true],
    ['an object', { bytes: 10 }],
    ['an array', ['10']],
  ])('parseRequestedBytes rejects %s', (_label, raw) => {
    const result = IntentsUseCases.parseRequestedBytes(raw)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // getIntent
  // ────────────────────────────────────────────────────────────────────────────

  it('getIntent should return ok when found', async () => {
    const intent: Intent = {
      id: '0x1',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const result = await IntentsUseCases.getIntent(user, intent.id)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().id).toBe(intent.id)
  })

  it('getIntent should error when not found', async () => {
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)
    const result = await IntentsUseCases.getIntent(user, '0xnope')
    expect(result.isErr()).toBe(true)
  })

  it('getIntent should return GoneError when intent is expired', async () => {
    const expired: Intent = {
      id: '0x1e',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(expired)

    const result = await IntentsUseCases.getIntent(user, expired.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoneError)
  })

  it('getIntent should return ok when expiresAt is in the future', async () => {
    const active: Intent = {
      id: '0x1f',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min ahead
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(active)

    const result = await IntentsUseCases.getIntent(user, active.id)
    expect(result.isOk()).toBe(true)
  })

  it('getIntent should treat missing expiresAt as expired (legacy rows)', async () => {
    const legacy: Intent = {
      id: '0x1l',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      // no expiresAt — pre-feature row, must be treated as expired
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(legacy)

    const result = await IntentsUseCases.getIntent(user, legacy.id)
    expect(result.isOk()).toBe(false)
  })

  it('getIntent should return ok for PENDING intent with txHash even if expiresAt is past', async () => {
    const watched: Intent = {
      id: '0x1w',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      txHash: '0xsubmitted',
      expiresAt: new Date(Date.now() - 60 * 1000), // 1 min in the past
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(watched)

    const result = await IntentsUseCases.getIntent(user, watched.id)
    expect(result.isOk()).toBe(true)
  })

  it('getIntent should return ok for CONFIRMED intent even if expiresAt is past', async () => {
    const confirmed: Intent = {
      id: '0x1c',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 60 * 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(confirmed)

    const result = await IntentsUseCases.getIntent(user, confirmed.id)
    expect(result.isOk()).toBe(true)
  })

  it('getIntent should return ok for COMPLETED intent even if expiresAt is past', async () => {
    const completed: Intent = {
      id: '0x1d',
      userPublicId: user.publicId,
      status: IntentStatus.COMPLETED,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 60 * 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(completed)

    const result = await IntentsUseCases.getIntent(user, completed.id)
    expect(result.isOk()).toBe(true)
  })

  it('getIntent should return GoneError when intent status is EXPIRED', async () => {
    const expired: Intent = {
      id: '0x1x',
      userPublicId: user.publicId,
      status: IntentStatus.EXPIRED,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(expired)

    const result = await IntentsUseCases.getIntent(user, expired.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoneError)
  })

  it('getIntent should error with forbidden when user does not match', async () => {
    const intent: Intent = {
      id: '0x9',
      userPublicId: 'different-user',
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const result = await IntentsUseCases.getIntent(user, intent.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // triggerWatchIntent
  // ────────────────────────────────────────────────────────────────────────────

  it('triggerWatchIntent should publish event and set txHash when user matches', async () => {
    const intent: Intent = {
      id: '0x2',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, txHash: '0xhash' })
    const publishSpy = jest
      .spyOn(EventRouter, 'publish')
      .mockImplementation(() => Promise.resolve())

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xhash',
      intentId: intent.id,
    })

    expect(res.isOk()).toBe(true)
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'watch-intent-tx' }),
    )
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: intent.id, txHash: '0xhash' }),
    )
  })

  it('triggerWatchIntent should forbid when user mismatches', async () => {
    const intent: Intent = {
      id: '0x3',
      userPublicId: 'other',
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xhash',
      intentId: intent.id,
    })

    expect(res.isErr()).toBe(true)
    expect(res._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('triggerWatchIntent should return GoneError when intent is expired', async () => {
    const expired: Intent = {
      id: '0x2e',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 1000), // already past
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(expired)

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xhash',
      intentId: expired.id,
    })

    expect(res.isErr()).toBe(true)
    expect(res._unsafeUnwrapErr()).toBeInstanceOf(GoneError)
  })

  it('triggerWatchIntent should error when intent not found', async () => {
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xhash',
      intentId: '0xnotfound',
    })

    expect(res.isErr()).toBe(true)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // markIntentAsConfirmed
  // ────────────────────────────────────────────────────────────────────────────

  it('markIntentAsConfirmed should set status CONFIRMED and deposit amount', async () => {
    const intent: Intent = {
      id: '0x4',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({
        ...intent,
        status: IntentStatus.CONFIRMED,
        paymentAmount: 10n,
      })

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 10n,
    })

    expect(res.isOk()).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: intent.id,
        status: IntentStatus.CONFIRMED,
        paymentAmount: 10n,
      }),
    )
  })

  it('markIntentAsConfirmed should error when intent not found', async () => {
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: '0xnotfound',
      paymentAmount: 100n,
    })

    expect(res.isErr()).toBe(true)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // onConfirmedIntent
  // ────────────────────────────────────────────────────────────────────────────

  it('onConfirmedIntent should add credits and complete intent', async () => {
    const paymentAmount = 123n * 10n ** 12n // yields 123 credits when pricePerMB=1
    const intent: Intent = {
      id: '0x5',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const addCreditsSpy = jest
      .spyOn(AccountsUseCases, 'addCreditsToAccount')
      .mockResolvedValue(ok())
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.COMPLETED })

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    // getIntentCredits now returns bigint; intentId is forwarded as third arg.
    const credits = paymentAmount / intent.shannonsPerByte

    expect(res.isOk()).toBe(true)
    expect(addCreditsSpy).toHaveBeenCalledWith(user.publicId, credits, intent.id)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: intent.id,
        status: IntentStatus.COMPLETED,
      }),
    )
  })

  it('onConfirmedIntent should use intent.pricePerMB, not current config', async () => {
    const storedPrice = 2n
    // Choose deposit so that credits = 123 when divided by storedPrice
    const paymentAmount = 123n * BigInt(storedPrice) * 10n ** 12n
    const intent: Intent = {
      id: '0x8',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount,
      shannonsPerByte: storedPrice,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const addCreditsSpy = jest
      .spyOn(AccountsUseCases, 'addCreditsToAccount')
      .mockResolvedValue(ok())
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.COMPLETED })

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    expect(res.isOk()).toBe(true)
    // getIntentCredits now returns bigint; intentId is forwarded as third arg.
    const credits = paymentAmount / intent.shannonsPerByte
    expect(addCreditsSpy).toHaveBeenCalledWith(user.publicId, credits, intent.id)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: intent.id,
        status: IntentStatus.COMPLETED,
      }),
    )
  })

  it('onConfirmedIntent should error when already completed', async () => {
    const intent: Intent = {
      id: '0x6',
      userPublicId: user.publicId,
      status: IntentStatus.COMPLETED,
      paymentAmount: 1n,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)
    expect(res.isErr()).toBe(true)
  })

  it('onConfirmedIntent should error when intent not found', async () => {
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)

    const res = await IntentsUseCases.onConfirmedIntent('0xnotfound')
    expect(res.isErr()).toBe(true)
  })

  it('onConfirmedIntent should error when payment amount is missing', async () => {
    const intent: Intent = {
      id: '0x10',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: undefined,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    expect(res.isErr()).toBe(true)
  })

  it('onConfirmedIntent should mark OVER_CAP (not retry) when cap is exceeded', async () => {
    const intent: Intent = {
      id: '0x11',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: 100n,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    jest
      .spyOn(AccountsUseCases, 'addCreditsToAccount')
      .mockResolvedValue(
        err(new ForbiddenError('Purchase would exceed per-user credit cap')),
      )
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.OVER_CAP })

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    // Must succeed (not error) so the polling loop stops retrying
    expect(res.isOk()).toBe(true)
    // Intent must be marked OVER_CAP, not COMPLETED or left as CONFIRMED
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: intent.id, status: IntentStatus.OVER_CAP }),
    )
  })

  it('onConfirmedIntent should NOT mark COMPLETED when capped — update must use OVER_CAP status', async () => {
    const intent: Intent = {
      id: '0x11c',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: 500n,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    jest
      .spyOn(AccountsUseCases, 'addCreditsToAccount')
      .mockResolvedValue(err(new ForbiddenError('cap')))
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.OVER_CAP })

    await IntentsUseCases.onConfirmedIntent(intent.id)

    // Verify status is specifically OVER_CAP, not COMPLETED
    expect(updateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: IntentStatus.COMPLETED }),
    )
  })

  // ────────────────────────────────────────────────────────────────────────────
  // cleanupExpiredIntents
  // ────────────────────────────────────────────────────────────────────────────

  it('cleanupExpiredIntents should call expireIntentIfPending for each expired intent', async () => {
    const expiredIntent: Intent = {
      id: '0xexp1',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 5000),
    }
    jest
      .spyOn(intentsRepository, 'getExpiredPendingIntents')
      .mockResolvedValue([expiredIntent])
    const expireSpy = jest
      .spyOn(intentsRepository, 'expireIntentIfPending')
      .mockResolvedValue(true)

    await IntentsUseCases.cleanupExpiredIntents()

    expect(expireSpy).toHaveBeenCalledWith(expiredIntent.id)
  })

  it('cleanupExpiredIntents should do nothing when no expired intents', async () => {
    jest
      .spyOn(intentsRepository, 'getExpiredPendingIntents')
      .mockResolvedValue([])
    const expireSpy = jest.spyOn(intentsRepository, 'expireIntentIfPending')

    await IntentsUseCases.cleanupExpiredIntents()

    expect(expireSpy).not.toHaveBeenCalled()
  })

  it('cleanupExpiredIntents should handle multiple expired intents', async () => {
    const expiredIntents: Intent[] = [
      {
        id: '0xexp2',
        userPublicId: user.publicId,
        status: IntentStatus.PENDING,
        shannonsPerByte: 1n,
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        id: '0xexp3',
        userPublicId: user.publicId,
        status: IntentStatus.PENDING,
        shannonsPerByte: 1n,
        expiresAt: new Date(Date.now() - 2000),
      },
    ]
    jest
      .spyOn(intentsRepository, 'getExpiredPendingIntents')
      .mockResolvedValue(expiredIntents)
    const expireSpy = jest
      .spyOn(intentsRepository, 'expireIntentIfPending')
      .mockResolvedValue(true)

    await IntentsUseCases.cleanupExpiredIntents()

    expect(expireSpy).toHaveBeenCalledTimes(2)
    expect(expireSpy).toHaveBeenCalledWith('0xexp2')
    expect(expireSpy).toHaveBeenCalledWith('0xexp3')
  })

  it('cleanupExpiredIntents should tolerate concurrent status changes (no-op on already-confirmed)', async () => {
    const expiredIntents: Intent[] = [
      {
        id: '0xexp4',
        userPublicId: user.publicId,
        status: IntentStatus.PENDING,
        shannonsPerByte: 1n,
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        id: '0xexp5',
        userPublicId: user.publicId,
        status: IntentStatus.PENDING,
        shannonsPerByte: 1n,
        expiresAt: new Date(Date.now() - 2000),
      },
    ]
    jest
      .spyOn(intentsRepository, 'getExpiredPendingIntents')
      .mockResolvedValue(expiredIntents)
    const expireSpy = jest
      .spyOn(intentsRepository, 'expireIntentIfPending')
      .mockResolvedValueOnce(true) // first intent expired normally
      .mockResolvedValueOnce(false) // second was confirmed concurrently

    await IntentsUseCases.cleanupExpiredIntents()

    expect(expireSpy).toHaveBeenCalledTimes(2)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Miscellaneous
  // ────────────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────────
  // getOverCapIntents
  // ────────────────────────────────────────────────────────────────────────────

  it('getOverCapIntents should return intents for admin users', async () => {
    const admin = { ...user, role: UserRole.Admin } as unknown as User
    const overCapIntent: Intent = {
      id: '0xoc1',
      userPublicId: user.publicId,
      status: IntentStatus.OVER_CAP,
      paymentAmount: 100n,
      shannonsPerByte: 1n,
    }
    jest
      .spyOn(intentsRepository, 'getOverCapIntents')
      .mockResolvedValue([overCapIntent])

    const result = await IntentsUseCases.getOverCapIntents(admin)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([overCapIntent])
  })

  it('getOverCapIntents should return ForbiddenError for non-admin users', async () => {
    const nonAdmin = { ...user, role: UserRole.User } as unknown as User
    const repoSpy = jest.spyOn(intentsRepository, 'getOverCapIntents')

    const result = await IntentsUseCases.getOverCapIntents(nonAdmin)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    // Repository must not be called — admin check happens first
    expect(repoSpy).not.toHaveBeenCalled()
  })

  it('getOverCapIntents should return empty array when no capped intents exist', async () => {
    const admin = { ...user, role: UserRole.Admin } as unknown as User
    jest.spyOn(intentsRepository, 'getOverCapIntents').mockResolvedValue([])

    const result = await IntentsUseCases.getOverCapIntents(admin)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  // ────────────────────────────────────────────────────────────────────────────
  // reprocessOverCapIntent
  // ────────────────────────────────────────────────────────────────────────────

  it('reprocessOverCapIntent should reset OVER_CAP intent to CONFIRMED', async () => {
    const admin = { ...user, role: UserRole.Admin } as unknown as User
    const overCapIntent: Intent = {
      id: '0xrp1',
      userPublicId: user.publicId,
      status: IntentStatus.OVER_CAP,
      paymentAmount: 100n,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(overCapIntent)
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...overCapIntent, status: IntentStatus.CONFIRMED })

    const result = await IntentsUseCases.reprocessOverCapIntent(admin, overCapIntent.id)

    expect(result.isOk()).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: overCapIntent.id,
        status: IntentStatus.CONFIRMED,
      }),
    )
  })

  it('reprocessOverCapIntent should return ForbiddenError for non-admin', async () => {
    const nonAdmin = { ...user, role: UserRole.User } as unknown as User
    const repoSpy = jest.spyOn(intentsRepository, 'getById')

    const result = await IntentsUseCases.reprocessOverCapIntent(nonAdmin, '0xrp2')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    expect(repoSpy).not.toHaveBeenCalled()
  })

  it('reprocessOverCapIntent should return ObjectNotFoundError when intent missing', async () => {
    const admin = { ...user, role: UserRole.Admin } as unknown as User
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)

    const result = await IntentsUseCases.reprocessOverCapIntent(admin, '0xrp3')

    expect(result.isErr()).toBe(true)
  })

  it('reprocessOverCapIntent should return ConflictError when intent is not OVER_CAP', async () => {
    const admin = { ...user, role: UserRole.Admin } as unknown as User
    const completedIntent: Intent = {
      id: '0xrp4',
      userPublicId: user.publicId,
      status: IntentStatus.COMPLETED,
      paymentAmount: 100n,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(completedIntent)
    const updateSpy = jest.spyOn(intentsRepository, 'updateIntent')

    const result = await IntentsUseCases.reprocessOverCapIntent(admin, completedIntent.id)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    // Must not attempt to update an intent that isn't OVER_CAP
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('reprocessOverCapIntent should return ConflictError for PENDING, CONFIRMED, EXPIRED statuses', async () => {
    const admin = { ...user, role: UserRole.Admin } as unknown as User
    const statuses = [IntentStatus.PENDING, IntentStatus.CONFIRMED, IntentStatus.EXPIRED]

    for (const status of statuses) {
      const intent: Intent = {
        id: `0xrp-${status}`,
        userPublicId: user.publicId,
        status,
        shannonsPerByte: 1n,
      }
      jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

      const result = await IntentsUseCases.reprocessOverCapIntent(admin, intent.id)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    }
  })

  it('getConfirmedIntents should proxy repository', async () => {
    const intents: Intent[] = [
      {
        id: '0x7',
        userPublicId: user.publicId,
        status: IntentStatus.CONFIRMED,
        shannonsPerByte: 1n,
      },
    ]
    jest.spyOn(intentsRepository, 'getByStatus').mockResolvedValue(intents)
    const res = await IntentsUseCases.getConfirmedIntents()
    expect(res).toEqual(intents)
  })

  it('getIntentCredits should calculate credits correctly', () => {
    const intent: Intent = {
      id: '0x12',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: 1000n,
      shannonsPerByte: 10n,
    }

    const credits = IntentsUseCases.getIntentCredits(intent)
    expect(credits).toBe(100n)
  })

  it('getIntentCredits should return 0n when paymentAmount is undefined', () => {
    const intent: Intent = {
      id: '0x13',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: undefined,
      shannonsPerByte: 10n,
    }

    const credits = IntentsUseCases.getIntentCredits(intent)
    expect(credits).toBe(0n)
  })

  it('updateIntent should proxy repository', async () => {
    const intent: Intent = {
      id: '0x14',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
    }
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue(intent)

    const result = await IntentsUseCases.updateIntent(intent)

    expect(updateSpy).toHaveBeenCalledWith(intent)
    expect(result).toEqual(intent)
  })
})
