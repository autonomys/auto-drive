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
  ObjectNotFoundError,
  QuoteErrorCode,
  QuoteFailedError,
  ServiceUnavailableError,
  UsdcPaymentsDisabledError,
} from '../../../src/errors/index.js'
import { intentMispaymentsRepository } from '../../../src/infrastructure/repositories/users/intentMispayments.js'
import {
  IntentMispaymentReason,
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
  OracleUnavailableError,
  type OraclePrice,
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

  // Paying in USDC is gated (featureFlags.payWithUsdc). Almost every test below
  // is about what a quote contains rather than about who may ask for one, so the
  // flag is opened here and the gate itself is tested separately.
  const usdcFlag = config.featureFlags.flags.payWithUsdc
  const usdcFlagDefault = usdcFlag.active
  // A deployment that accepts USDC, which now takes a complete Ethereum
  // configuration as well as an open flag: createIntent refuses to quote an
  // asset whose payments nothing would be watching for. .env.test sets no ETH_*
  // keys, so every USDC case has to say so.
  const ethereumDefaults = { ...config.ethereum }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(IntentsUseCases, 'getPrice').mockResolvedValue({ price: 1, pricePerGB: 1073741824 })
    usdcFlag.active = true
    config.ethereum.rpcUrl = 'http://example.org'
    config.ethereum.usdcReceiverAddress =
      '0x1111111111111111111111111111111111111111'
    config.ethereum.usdcTokenAddress =
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  })

  afterEach(() => {
    jest.restoreAllMocks()
    usdcFlag.active = usdcFlagDefault
    Object.assign(config.ethereum, ethereumDefaults)
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
    // half of the rate the payment converts at. See the USDC group below. That
    // makes the assertion below load-bearing in a second way — it is what keeps
    // the quote fields on the path that has a quote.
    //
    // The whole row is asserted, deliberately. The obvious spelling — checking
    // that no key is named after the size — cannot fail: `Intent` has no size
    // field, so TypeScript's excess-property check already rejects adding one
    // to this object literal. What the compiler cannot catch is the size
    // reaching the row under a field that DOES exist (`paymentAmount:
    // requestedBytes`), and a value-based check catches that but only while no
    // legitimate field happens to hold the same number — it would start failing
    // spuriously the moment the mocked price became realistic.
    //
    // Pinning every field has neither weakness, and adds one the others lack:
    // it fails when the row grows a field this test has not considered, which
    // is exactly when someone should look at it again. toStrictEqual counts a
    // present-but-undefined key as a difference, so an AI3 row that started
    // carrying quotedAi3Shannons at all would fail here.
    const created = createSpy.mock.calls[0][0]
    expect(created).toStrictEqual({
      id: expect.any(String),
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      paymentMethod: PaymentMethod.AI3_NATIVE,
      paymentAmount: undefined,
      shannonsPerByte: 1n,
      expiresAt: expect.any(Date),
    })
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

  const RATE = 6_400_000_000_000_000n // $0.0064/AI3, scaled 1e18

  // What the oracle reports: one size-independent rate. There is no per-size
  // quote to stub any more — the charge is this rate times the purchase, so
  // these tests assert the arithmetic rather than a mocked pool answer.
  const stubPrice = (overrides: Partial<OraclePrice> = {}): OraclePrice => ({
    usdPerAi3: RATE,
    asOf: new Date(),
    fromCache: false,
    stale: false,
    ...overrides,
  })

  const mockPrice = (overrides: Partial<OraclePrice> = {}) =>
    jest
      .spyOn(priceOracle, 'getPrice')
      .mockResolvedValue(ok(stubPrice(overrides)))

  // The charge the code should arrive at, derived the same way production does.
  const expectedCharge = (ai3Shannons: bigint, rate = RATE) =>
    applyMarginPercent(
      ai3ShannonsToUsdcBaseUnits(ai3Shannons, rate),
      config.credits.usdQuoteMarginPercent,
    )

  // ────────────────────────────────────────────────────────────────────────────
  // The payWithUsdc gate
  // ────────────────────────────────────────────────────────────────────────────

  it('createIntent refuses USDC when the flag is off', async () => {
    usdcFlag.active = false
    const accountSpy = jest.spyOn(AccountsUseCases, 'getOrCreateAccount')
    const priceSpy = jest.spyOn(IntentsUseCases, 'getPrice')
    const rateSpy = jest.spyOn(priceOracle, 'getPrice')
    const createSpy = jest.spyOn(intentsRepository, 'createIntent')

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 1000n,
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UsdcPaymentsDisabledError)
    expect((error as UsdcPaymentsDisabledError).statusCode).toBe(403)
    // Refused before anything is read, priced or written: a caller who cannot
    // use the asset costs nothing to turn away.
    expect(accountSpy).not.toHaveBeenCalled()
    expect(priceSpy).not.toHaveBeenCalled()
    expect(rateSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('createIntent refuses USDC when Ethereum is not configured, admin or not', async () => {
    // The gap this closes: the flag's admin exemption exists so the path can be
    // driven end to end in production, which means an admin is the FIRST person
    // to reach it — with real money. On a deployment with no Ethereum receiver
    // there is no watcher, so the quote would be a binding amount whose payment
    // nothing observes: no confirmation, no credits, and no mispayment row
    // either, because nothing is reading that chain to file one.
    usdcFlag.active = false
    config.ethereum.rpcUrl = undefined
    config.ethereum.usdcReceiverAddress = undefined
    config.ethereum.usdcTokenAddress = undefined

    const createSpy = jest.spyOn(intentsRepository, 'createIntent')
    const oracleSpy = jest.spyOn(priceOracle, 'getPrice')

    const admin = {
      ...orgUser,
      role: UserRole.Admin,
    } as unknown as UserWithOrganization

    const res = await IntentsUseCases.createIntent(admin, {
      paymentMethod: PaymentMethod.USDC_ETH,
      requestedBytes: 1024n,
    })

    expect(res.isErr()).toBe(true)
    if (res.isErr()) {
      expect(res.error).toBeInstanceOf(UsdcPaymentsDisabledError)
    }
    // Refused before anything is spent or written: no rate read, no row.
    expect(oracleSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('createIntent refuses USDC on a half-configured deployment', async () => {
    // The receiver alone is not enough, and this is the case that reaches
    // production: the watcher throws on a partial configuration, but only the
    // payment worker ever builds it. `start:fe:api` does not, so the API would
    // keep serving — and quoting — while the worker crash-loops on the missing
    // variable. A binding quote with nobody watching, which is what the guard
    // exists to prevent.
    config.ethereum.usdcTokenAddress = undefined

    const createSpy = jest.spyOn(intentsRepository, 'createIntent')
    const oracleSpy = jest.spyOn(priceOracle, 'getPrice')

    const res = await IntentsUseCases.createIntent(orgUser, {
      paymentMethod: PaymentMethod.USDC_ETH,
      requestedBytes: 1024n,
    })

    expect(res.isErr()).toBe(true)
    if (res.isErr()) {
      expect(res.error).toBeInstanceOf(UsdcPaymentsDisabledError)
    }
    expect(oracleSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('createIntent lets an admin pay in USDC while the flag is off', async () => {
    // The point of the exemption: the path stays exercisable against production
    // while it is shut to everyone else.
    usdcFlag.active = false
    mockPurchasedBalance(0n)
    mockPrice()
    const createSpy = jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const admin = {
      ...orgUser,
      role: UserRole.Admin,
    } as unknown as UserWithOrganization

    const result = await IntentsUseCases.createIntent(admin, {
      requestedBytes: 1000n,
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    expect(result.isOk()).toBe(true)
    expect(createSpy.mock.calls[0][0].quotedTokenAmount).toBe(
      expectedCharge(1000n),
    )
  })

  it('createIntent is unaffected by the USDC flag on the AI3 path', async () => {
    usdcFlag.active = false
    const createSpy = jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const result = await IntentsUseCases.createIntent(orgUser)

    expect(result.isOk()).toBe(true)
    expect(createSpy.mock.calls[0][0].paymentMethod).toBe(
      PaymentMethod.AI3_NATIVE,
    )
  })

  // ────────────────────────────────────────────────────────────────────────────

  it('createIntent refuses to create an intent at a zero per-byte price', async () => {
    // CREDITS_PRICE_MULTIPLIER=0, or a chain reporting a zero byte fee. Every
    // payment against such an intent converts to 0 credits and lands in FAILED
    // with the money kept, and on the USDC path the quote itself would be 0.
    jest
      .spyOn(IntentsUseCases, 'getPrice')
      .mockResolvedValue({ price: 0, pricePerGB: 0 })
    mockPurchasedBalance(0n)
    const rateSpy = jest.spyOn(priceOracle, 'getPrice')
    const createSpy = jest.spyOn(intentsRepository, 'createIntent')

    for (const paymentMethod of [
      PaymentMethod.AI3_NATIVE,
      PaymentMethod.USDC_ETH,
    ]) {
      const result = await IntentsUseCases.createIntent(orgUser, {
        requestedBytes: 1000n,
        paymentMethod,
      })

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      // The request was fine; the deployment is not. 503, not 4xx.
      expect(error).toBeInstanceOf(ServiceUnavailableError)
      expect((error as ServiceUnavailableError).statusCode).toBe(503)
    }

    // No unpriceable intent is written, and no rate is fetched to price one.
    expect(rateSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('createIntent requires requestedBytes when paying with USDC', async () => {
    const rateSpy = jest.spyOn(priceOracle, 'getPrice')
    const priceSpy = jest.spyOn(IntentsUseCases, 'getPrice')
    const createSpy = jest.spyOn(intentsRepository, 'createIntent')

    const result = await IntentsUseCases.createIntent(orgUser, {
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    // Nothing may be priced, quoted or written without a size to quote for.
    expect(priceSpy).not.toHaveBeenCalled()
    expect(rateSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('createIntent still allows an AI3 intent with no requestedBytes', async () => {
    jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    // Making the size mandatory on USDC must not make it mandatory on the path
    // third-party API keys already call.
    const result = await IntentsUseCases.createIntent(orgUser, {
      paymentMethod: PaymentMethod.AI3_NATIVE,
    })

    expect(result.isOk()).toBe(true)
  })

  it('createIntent defaults an unspecified payment method to AI3', async () => {
    const createSpy = jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const result = await IntentsUseCases.createIntent(orgUser)

    expect(result.isOk()).toBe(true)
    expect(createSpy.mock.calls[0][0].paymentMethod).toBe(
      PaymentMethod.AI3_NATIVE,
    )
  })

  it('createIntent charges for the AI3 value of the purchase, not the byte count', async () => {
    mockPurchasedBalance(0n)
    mockPrice()
    const createSpy = jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)
    // shannonsPerByte = 3 here, so the AI3 the purchase is worth — and what the
    // rate gets applied to — is 1000 bytes * 3 = 3000 shannons.
    jest
      .spyOn(IntentsUseCases, 'getPrice')
      .mockResolvedValue({ price: 3, pricePerGB: 1 })

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 1000n,
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    expect(result.isOk()).toBe(true)
    const created = createSpy.mock.calls[0][0]
    expect(created.quotedAi3Shannons).toBe(3000n)
    expect(created.quotedTokenAmount).toBe(expectedCharge(3000n))
  })

  it('createIntent persists the charge, what it was charged for, and the raw rate', async () => {
    mockPurchasedBalance(0n)
    mockPrice()
    const createSpy = jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 1000n,
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    expect(result.isOk()).toBe(true)
    const created = createSpy.mock.calls[0][0]
    // The method has to reach the row: it is what the payment manager routes on.
    expect(created.paymentMethod).toBe(PaymentMethod.USDC_ETH)
    // shannonsPerByte is 1 from the default getPrice mock.
    expect(created.quotedAi3Shannons).toBe(1000n)
    // The rate applied to the purchase, then the margin on top.
    expect(created.quotedTokenAmount).toBe(expectedCharge(1000n))
    // The stored rate stays the raw oracle rate — display and reconciliation
    // data, never the conversion rate.
    expect(created.usdRateAtCreation).toBe(RATE)
  })

  it('createIntent does not read a rate until the cap pre-check has passed', async () => {
    mockPurchasedBalance(cap - 100n)
    const rateSpy = jest.spyOn(priceOracle, 'getPrice')
    const createSpy = jest.spyOn(intentsRepository, 'createIntent')

    const result = await IntentsUseCases.createIntent(orgUser, {
      requestedBytes: 101n,
      paymentMethod: PaymentMethod.USDC_ETH,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(CreditCapExceededError)
    // A subgraph round-trip is not spent on a purchase that cannot be granted.
    expect(rateSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  // Every refusal is a 503. None of them is about the size, because the rate is
  // size-independent — asking for less can never turn one into a quote, and a
  // 4xx would tell the user otherwise.
  it.each<[string, Error, QuoteErrorCode]>([
    [
      'an unreadable source',
      new OracleUnavailableError('gateway did not respond', 'gateway'),
      QuoteErrorCode.ORACLE_UNAVAILABLE,
    ],
    [
      'too few swaps to average',
      new OracleUnavailableError('3 usable swaps', 'insufficient-samples'),
      QuoteErrorCode.ORACLE_UNAVAILABLE,
    ],
    [
      'a pool too thin to price from',
      new OracleUnavailableError('180 USDC of depth', 'thin-liquidity'),
      QuoteErrorCode.ORACLE_UNAVAILABLE,
    ],
    [
      'a market that has re-priced past the window',
      new OracleUnavailableError('newest fill is an outlier', 'market-moved'),
      QuoteErrorCode.PRICE_UNSTABLE,
    ],
  ])(
    'createIntent maps %s to a 503 with the right code',
    async (_label, oracleError, expectedCode) => {
      mockPurchasedBalance(0n)
      jest
        .spyOn(priceOracle, 'getPrice')
        .mockResolvedValue(err(oracleError as OracleUnavailableError))
      const createSpy = jest.spyOn(intentsRepository, 'createIntent')

      const result = await IntentsUseCases.createIntent(orgUser, {
        requestedBytes: 1000n,
        paymentMethod: PaymentMethod.USDC_ETH,
      })

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(QuoteFailedError)
      expect((error as QuoteFailedError).statusCode).toBe(503)
      expect((error as QuoteFailedError).code).toBe(expectedCode)
      // A failed quote must not leave a PENDING intent with no price behind.
      expect(createSpy).not.toHaveBeenCalled()
    },
  )

  it('createIntent treats an unrecognised quote failure as retryable, not as bad input', async () => {
    // A reason added to OracleUnavailableReason after the mapping was written —
    // the union has grown twice already. It must not fall through to a 4xx that
    // tells the user to change a request that was fine.
    mockPurchasedBalance(0n)
    jest
      .spyOn(priceOracle, 'getPrice')
      .mockResolvedValue(
        err(
          new OracleUnavailableError(
            'something new',
            'a-guard-invented-later' as never,
          ),
        ),
      )

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
    mockPrice()
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

  it('converting at the raw rate would over-credit by the margin — the regression this guards', () => {
    const requestedBytes = 1_073_741_824n
    const shannonsPerByte = 422_005_541_622n
    const quotedAi3Shannons = requestedBytes * shannonsPerByte
    const usdPerAi3 = RATE
    // The charge is the raw rate plus the margin, and nothing else. Under the
    // retired Quoter the gap also carried the swap fee and this size's own price
    // impact; since #807 both live inside the rate, so the margin is the entire
    // wedge — which makes it exactly what leaks if the raw rate is used to
    // convert.
    const quotedTokenAmount = applyMarginPercent(
      ai3ShannonsToUsdcBaseUnits(quotedAi3Shannons, usdPerAi3),
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

    // Wrong: converting the same payment at the raw rate. The error is the whole
    // margin, exactly — a rate is a scalar, so it scales with the amount rather
    // than washing out on large purchases.
    const viaRawRate =
      (quotedTokenAmount * 10n ** 30n) / usdPerAi3 / shannonsPerByte
    expect(viaRawRate).toBeGreaterThan(requestedBytes)
    const overCreditBps =
      ((viaRawRate - requestedBytes) * 10_000n) / requestedBytes
    // USD_QUOTE_MARGIN is 5% by default; assert against the configured value so
    // this keeps meaning "the margin" if it is ever retuned.
    expect(overCreditBps).toBeGreaterThan(
      BigInt(Math.floor(config.credits.usdQuoteMarginPercent * 100)) - 10n,
    )
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
    const confirmSpy = jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
      .mockImplementation(async (args) => ({
        ...intent,
        status: IntentStatus.CONFIRMED,
        tokenAmount: args.tokenAmount,
        fromAddress: args.fromAddress,
      }))

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      tokenAmount: 1_050_000n,
      fromAddress: '0xpayer',
    })

    expect(res.isOk()).toBe(true)
    const written = confirmSpy.mock.calls[0][0]
    expect(written.tokenAmount).toBe(1_050_000n)
    // paymentAmount is denominated in shannons; writing USDC into it would make
    // every AI3-shaped read of the row wrong.
    expect(written.paymentAmount).toBeUndefined()
    // The quote columns are not in the statement at all, so no stale snapshot can
    // null the numbers credits are derived from.
    expect(res._unsafeUnwrap().quotedTokenAmount).toBe(1_050_000n)
    expect(res._unsafeUnwrap().quotedAi3Shannons).toBe(1000n)
  })

  it('markIntentAsConfirmed accounts for both payments in one transaction', async () => {
    // watchTransaction calls this once per parsed log inside a Promise.all, so two
    // payments for one intent in a single transaction both read PENDING before
    // either writes. An unconditional write let the second overwrite the first:
    // one amount credited, the other gone, and nothing filed either way. Same
    // amounts on purpose — the three-signal check above cannot separate those, and
    // the conditional transition is what does.
    let row: Intent = {
      id: '0xone-tx-two-logs',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.AI3_NATIVE,
    }
    jest
      .spyOn(intentsRepository, 'getById')
      .mockImplementation(async () => ({ ...row }))
    // Mirrors the SQL: the UPDATE only lands while the row is still PENDING.
    const confirmSpy = jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
      .mockImplementation(async (args) => {
        if (row.status !== IntentStatus.PENDING) return null
        row = {
          ...row,
          status: IntentStatus.CONFIRMED,
          paymentAmount: args.paymentAmount,
          txHash: args.txHash,
        }
        return { ...row }
      })
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    await Promise.all([
      IntentsUseCases.markIntentAsConfirmed({
        intentId: row.id,
        paymentAmount: 100n,
        txHash: '0xonetx',
        logIndex: 0,
      }),
      IntentsUseCases.markIntentAsConfirmed({
        intentId: row.id,
        paymentAmount: 100n,
        txHash: '0xonetx',
        logIndex: 1,
      }),
    ])

    // One won the transition and is credited; the other is on file rather than
    // lost. Both are accounted for, which is the whole point.
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(row.status).toBe(IntentStatus.CONFIRMED)
    expect(recordSpy).toHaveBeenCalledTimes(1)
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: row.id,
        reason: IntentMispaymentReason.ALREADY_SETTLED,
        paymentAmount: 100n,
      }),
    )
  })

  it('markIntentAsConfirmed does not call a lost expiry race a double payment', async () => {
    // expireIntentIfPending competes for the same PENDING status, so the sweep can
    // be what makes the conditional confirm miss. Nothing was credited in that
    // case, and filing it as ALREADY_SETTLED would tell an admin to reconcile a
    // double payment that never happened.
    const intent: Intent = {
      id: '0xexpired-mid-confirm',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.AI3_NATIVE,
    }
    jest
      .spyOn(intentsRepository, 'getById')
      // PENDING on the way in; the sweep has taken it by the read-back.
      .mockResolvedValueOnce(intent)
      .mockResolvedValue({ ...intent, status: IntentStatus.EXPIRED })
    jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
      .mockResolvedValue(null)
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 500n,
      txHash: '0xtoo-late',
      logIndex: 0,
    })

    expect(res.isOk()).toBe(true)
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: intent.id,
        reason: IntentMispaymentReason.INTENT_EXPIRED,
        paymentAmount: 500n,
      }),
    )
  })

  it('markIntentAsConfirmed files no off-quote row for a payment that lost the race', async () => {
    // The off-quote check runs after the transition, so a payment that never
    // settled anything is filed once as ALREADY_SETTLED rather than also as an
    // off-quote settlement it did not make.
    const intent: Intent = {
      id: '0xlost-race-offquote',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
      .mockResolvedValue(null)
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      tokenAmount: 900_000n,
      txHash: '0xlate',
      logIndex: 3,
    })

    expect(res.isOk()).toBe(true)
    expect(recordSpy).toHaveBeenCalledTimes(1)
    expect(recordSpy.mock.calls[0][0].reason).toBe(
      IntentMispaymentReason.ALREADY_SETTLED,
    )
  })

  it('markIntentAsConfirmed files a payment that arrived after the intent expired', async () => {
    // Not the same no-op as re-delivery for a settled intent. EXPIRED means
    // nothing was ever paid as far as the row knows, so money arriving now is a
    // payment with no record anywhere. It cannot be granted — the quoted rate is
    // gone — but returning quietly would leave an irreversible transfer with
    // nothing pointing at it.
    const intent: Intent = {
      id: '0xexpired-paid',
      userPublicId: user.publicId,
      status: IntentStatus.EXPIRED,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.AI3_NATIVE,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest.spyOn(intentsRepository, 'updateIntent')
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 5n * 10n ** 18n,
      fromAddress: '0xpayer',
      txHash: '0xlate',
      logIndex: 0,
    })

    // ok(): the intent is untouched and there is nothing for the watcher to retry.
    expect(res.isOk()).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(recordSpy).toHaveBeenCalledWith({
      intentId: intent.id,
      reason: IntentMispaymentReason.INTENT_EXPIRED,
      expectedPaymentMethod: PaymentMethod.AI3_NATIVE,
      paymentAmount: 5n * 10n ** 18n,
      tokenAmount: undefined,
      fromAddress: '0xpayer',
      txHash: '0xlate',
      logIndex: 0,
    })
  })

  it('markIntentAsConfirmed files an off-quote payment and still credits it', async () => {
    // Underpaying a quote the API advertised as exact. The grant stays
    // proportional — the user gets storage worth what they sent — but nothing on
    // the intent afterwards compares the two amounts, so without this row the
    // only signal is a balance the user has to notice looks short.
    const intent: Intent = {
      id: '0xusdc-underpaid',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const confirmSpy = jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
      .mockImplementation(async (args) => ({
        ...intent,
        status: IntentStatus.CONFIRMED,
        tokenAmount: args.tokenAmount,
      }))
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      tokenAmount: 840_000n,
      fromAddress: '0xpayer',
      txHash: '0xshort',
      logIndex: 1,
    })

    // Accepted, not refused: refusing would leave a paying user with no storage
    // and put the payment in a queue that has no grant path out.
    expect(res.isOk()).toBe(true)
    expect(confirmSpy).toHaveBeenCalled()
    expect(confirmSpy.mock.calls[0][0].tokenAmount).toBe(840_000n)
    expect(res._unsafeUnwrap().status).toBe(IntentStatus.CONFIRMED)

    expect(recordSpy).toHaveBeenCalledWith({
      intentId: intent.id,
      reason: IntentMispaymentReason.AMOUNT_OFF_QUOTE,
      expectedPaymentMethod: PaymentMethod.USDC_ETH,
      paymentAmount: undefined,
      tokenAmount: 840_000n,
      fromAddress: '0xpayer',
      txHash: '0xshort',
      logIndex: 1,
    })
  })

  it('markIntentAsConfirmed files an overpayment too', async () => {
    // Paying over the quote grants proportionally more, past the size the cap
    // pre-check ran against. Bounded by the authoritative check under the
    // advisory lock, but still worth a record.
    const intent: Intent = {
      id: '0xusdc-overpaid',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
      .mockImplementation(async () => ({
        ...intent,
        status: IntentStatus.CONFIRMED,
        tokenAmount: 2_000_000n,
      }))
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      tokenAmount: 2_000_000n,
    })

    expect(res.isOk()).toBe(true)
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: IntentMispaymentReason.AMOUNT_OFF_QUOTE,
        tokenAmount: 2_000_000n,
      }),
    )
  })

  it('markIntentAsConfirmed files nothing when the quote is paid exactly', async () => {
    // The common case must stay silent, or the record stops meaning anything.
    const intent: Intent = {
      id: '0xusdc-exact',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
      .mockImplementation(async () => ({
        ...intent,
        status: IntentStatus.CONFIRMED,
        tokenAmount: 1_050_000n,
      }))
    const recordSpy = jest.spyOn(intentMispaymentsRepository, 'record')

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      tokenAmount: 1_050_000n,
    })

    expect(res.isOk()).toBe(true)
    expect(recordSpy).not.toHaveBeenCalled()
  })

  it('markIntentAsConfirmed files nothing for an AI3 payment of any size', async () => {
    // An AI3 intent is quoted no amount — credits follow whatever arrives — so
    // there is no promise for a payment to deviate from and nothing to record.
    const intent: Intent = {
      id: '0xai3-any-amount',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.AI3_NATIVE,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
      .mockImplementation(async () => ({
        ...intent,
        status: IntentStatus.CONFIRMED,
        paymentAmount: 7n * 10n ** 18n,
      }))
    const recordSpy = jest.spyOn(intentMispaymentsRepository, 'record')

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 7n * 10n ** 18n,
    })

    expect(res.isOk()).toBe(true)
    expect(recordSpy).not.toHaveBeenCalled()
  })

  it('markIntentAsConfirmed refuses an AI3 payment against a USDC intent', async () => {
    // The live watcher reports every payIntent event as paymentAmount, and
    // payIntent(bytes32) accepts ANY intent id — so this arrives as a well-formed
    // call and nothing upstream rejects it.
    const intent: Intent = {
      id: '0xusdc-mispaid',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest.spyOn(intentsRepository, 'updateIntent')

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 5n * 10n ** 18n,
    })

    expect(res.isErr()).toBe(true)
    expect(res._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    // Must not go CONFIRMED. Doing so would strand the row in the polling loop
    // AND make the idempotency guard discard the user's real USDC payment.
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('markIntentAsConfirmed refuses a token payment against an AI3 intent', async () => {
    const intent: Intent = {
      id: '0xai3-mispaid',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.AI3_NATIVE,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest.spyOn(intentsRepository, 'updateIntent')

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      tokenAmount: 1_050_000n,
    })

    expect(res.isErr()).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('markIntentAsConfirmed still treats a duplicate event on a settled intent as a no-op', async () => {
    // The asset check must not turn re-delivery into an error, or the watcher
    // would retry a genuinely settled intent indefinitely. The payment here is in
    // the other asset, so it is also money that arrived and cannot be attached —
    // recorded for that reason, while the return stays ok().
    const intent: Intent = {
      id: '0xusdc-dup',
      userPublicId: user.publicId,
      status: IntentStatus.COMPLETED,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      tokenAmount: 1_050_000n,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest.spyOn(intentsRepository, 'updateIntent')
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 5n * 10n ** 18n,
    })

    expect(res.isOk()).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: IntentMispaymentReason.ALREADY_SETTLED,
      }),
    )
  })

  it('markIntentAsConfirmed leaves a true replay of the settling payment silent', async () => {
    // Same transaction, same amount: this is the event that settled the intent
    // arriving again after a reorg or a restart. Recording it would put a
    // correctly-credited payment in the admin queue.
    const intent: Intent = {
      id: '0xusdc-replay',
      userPublicId: user.publicId,
      status: IntentStatus.COMPLETED,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      tokenAmount: 1_050_000n,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
      txHash: '0xsettled-here',
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest.spyOn(intentsRepository, 'updateIntent')
    const recordSpy = jest.spyOn(intentMispaymentsRepository, 'record')

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      tokenAmount: 1_050_000n,
      txHash: '0xsettled-here',
      logIndex: 0,
    })

    expect(res.isOk()).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(recordSpy).not.toHaveBeenCalled()
  })

  it('markIntentAsConfirmed files a second transfer paying the same quote twice', async () => {
    // The likely double-pay: the user does not see the first confirm and pays the
    // same quote again. Same amount, different transaction — the guard used to
    // absorb it and the money left no trace anywhere.
    const intent: Intent = {
      id: '0xusdc-paid-twice',
      userPublicId: user.publicId,
      status: IntentStatus.COMPLETED,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      tokenAmount: 1_050_000n,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
      txHash: '0xfirst',
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest.spyOn(intentsRepository, 'updateIntent')
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      tokenAmount: 1_050_000n,
      fromAddress: '0xpayer',
      txHash: '0xsecond',
      logIndex: 2,
    })

    // The settled intent is left exactly as it was; only the paperwork is new.
    expect(res.isOk()).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(recordSpy).toHaveBeenCalledWith({
      intentId: intent.id,
      reason: IntentMispaymentReason.ALREADY_SETTLED,
      expectedPaymentMethod: PaymentMethod.USDC_ETH,
      paymentAmount: undefined,
      tokenAmount: 1_050_000n,
      fromAddress: '0xpayer',
      txHash: '0xsecond',
      logIndex: 2,
    })
  })

  it('markIntentAsConfirmed files a differing second amount even with no hash on file', async () => {
    // An intent settled before confirmations began recording the hash has none to
    // compare against, so the amount has to carry it.
    const intent: Intent = {
      id: '0xai3-legacy-settled',
      userPublicId: user.publicId,
      status: IntentStatus.COMPLETED,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.AI3_NATIVE,
      paymentAmount: 500n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 900n,
      txHash: '0xlater',
    })

    expect(res.isOk()).toBe(true)
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: IntentMispaymentReason.ALREADY_SETTLED,
        paymentAmount: 900n,
      }),
    )
  })

  it('markIntentAsConfirmed records the transaction that settled the intent', async () => {
    // Only POST /intents/:id/watch used to write tx_hash, so an intent confirmed
    // by the contract-event watcher had no record of which transaction paid it —
    // and the guard above needs one to tell a later payment from re-delivery.
    const intent: Intent = {
      id: '0xai3-settling-hash',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.AI3_NATIVE,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const confirmSpy = jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
      .mockImplementation(async (args) => ({
        ...intent,
        status: IntentStatus.CONFIRMED,
        txHash: args.txHash,
      }))

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 500n,
      txHash: '0xpaid-by-this',
      logIndex: 0,
    })

    expect(res.isOk()).toBe(true)
    expect(confirmSpy.mock.calls[0][0].txHash).toBe('0xpaid-by-this')
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
  // Refused payments have to leave a durable record
  // ────────────────────────────────────────────────────────────────────────────

  it('markIntentAsConfirmed files a mispayment when the asset does not match', async () => {
    const intent: Intent = {
      id: '0xusdc-mispaid-recorded',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      quotedTokenAmount: 1_050_000n,
      quotedAi3Shannons: 1000n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 5n * 10n ** 18n,
      fromAddress: '0xpayer',
      txHash: '0xdeadbeef',
      logIndex: 2,
    })

    expect(res.isErr()).toBe(true)
    // Refusing is correct but resolves nothing on chain — the transfer happened.
    // Everything needed to find it again has to be written down, including where
    // in the transaction it sat: that is what separates two payments sharing a
    // hash, and what makes a replay de-duplicate instead of duplicating.
    expect(recordSpy).toHaveBeenCalledWith({
      intentId: intent.id,
      reason: IntentMispaymentReason.ASSET_MISMATCH,
      expectedPaymentMethod: PaymentMethod.USDC_ETH,
      paymentAmount: 5n * 10n ** 18n,
      tokenAmount: undefined,
      fromAddress: '0xpayer',
      txHash: '0xdeadbeef',
      logIndex: 2,
    })
  })

  it('markIntentAsConfirmed files a mispayment for an unknown intent id', async () => {
    // The case with the least other evidence: no intent row exists, so nothing
    // anywhere else records that money arrived.
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: '0xnosuchintent',
      paymentAmount: 5n * 10n ** 18n,
      fromAddress: '0xpayer',
      txHash: '0xfeedface',
      logIndex: 7,
    })

    expect(res.isErr()).toBe(true)
    expect(res._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: '0xnosuchintent',
        reason: IntentMispaymentReason.UNKNOWN_INTENT,
        txHash: '0xfeedface',
        logIndex: 7,
      }),
    )
  })

  it('markIntentAsConfirmed still refuses when the mispayment record cannot be written', async () => {
    // Filing the paperwork must not change which error actually happened: the
    // watcher would log the wrong cause, and on the startup-sweep path a throw
    // here would abort the recovery of unrelated transactions.
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)
    jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockRejectedValue(new Error('db down'))

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: '0xnosuchintent',
      paymentAmount: 1n,
    })

    expect(res.isErr()).toBe(true)
    expect(res._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
  })

  it('markIntentAsConfirmed files nothing when the payment is accepted', async () => {
    const intent: Intent = {
      id: '0xai3-fine',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.AI3_NATIVE,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
      .mockImplementation(async () => ({
        ...intent,
        status: IntentStatus.CONFIRMED,
        paymentAmount: 5n * 10n ** 18n,
      }))
    const recordSpy = jest.spyOn(intentMispaymentsRepository, 'record')

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 5n * 10n ** 18n,
    })

    expect(res.isOk()).toBe(true)
    expect(recordSpy).not.toHaveBeenCalled()
  })

  it('getMispayments is admin-only', async () => {
    const listSpy = jest
      .spyOn(intentMispaymentsRepository, 'list')
      .mockResolvedValue([])

    const denied = await IntentsUseCases.getMispayments(user)
    expect(denied.isErr()).toBe(true)
    expect(denied._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    expect(listSpy).not.toHaveBeenCalled()

    const allowed = await IntentsUseCases.getMispayments({
      ...user,
      role: UserRole.Admin,
    } as User)
    expect(allowed.isOk()).toBe(true)
    expect(listSpy).toHaveBeenCalled()
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

  it('getIntent should expire a PENDING intent whose txHash outlived the grace', async () => {
    // The exemption above assumes a txHash means "will resolve". A payment the
    // watcher refused, or a transaction that never confirms, breaks that: the row
    // could previously reach neither EXPIRED nor CONFIRMED, so getIntent kept
    // advertising it as payable indefinitely past its price lock and the startup
    // sweep re-watched it on every restart.
    const stale: Intent = {
      id: '0x1w-stale',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      txHash: '0xnever-confirmed',
      expiresAt: new Date(
        Date.now() -
          (config.credits.intentTxGraceMinutes + 60) * 60 * 1000,
      ),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(stale)

    const result = await IntentsUseCases.getIntent(user, stale.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoneError)
  })

  it('getIntent keeps the txHash exemption for a pre-feature row with no window', async () => {
    // Nothing to be past, so the hash keeps the exemption it had before the grace
    // existed.
    const legacy: Intent = {
      id: '0x1w-legacy',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      txHash: '0xsubmitted',
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(legacy)

    const result = await IntentsUseCases.getIntent(user, legacy.id)
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
    const setSpy = jest
      .spyOn(intentsRepository, 'setTxHashIfPending')
      .mockResolvedValue(true)
    const publishSpy = jest
      .spyOn(EventRouter, 'publish')
      .mockImplementation(() => Promise.resolve())

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xhash',
      intentId: intent.id,
    })

    expect(res.isOk()).toBe(true)
    expect(setSpy).toHaveBeenCalledWith(intent.id, '0xhash')
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'watch-intent-tx',
        // The chain travels with the task. A hash is the same 32 bytes on
        // either chain, so the worker that picks this up cannot derive it — and
        // by then the intent may have been expired by the cleanup sweep.
        params: { txHash: '0xhash', paymentMethod: PaymentMethod.AI3_NATIVE },
      }),
    )
  })

  it('triggerWatchIntent does not revert an intent confirmed while it was deciding', async () => {
    // getIntent hands back a PENDING snapshot; a confirmation lands before the
    // write. Writing that snapshot back reverted the status and nulled
    // payment_amount, so a credited payment became uncredited until a restart
    // re-watched the row. Reproduced before the fix.
    const intent: Intent = {
      id: '0xwatch-race',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    // The row is no longer PENDING by the time the write runs.
    const setSpy = jest
      .spyOn(intentsRepository, 'setTxHashIfPending')
      .mockResolvedValue(false)
    const updateSpy = jest.spyOn(intentsRepository, 'updateIntent')
    const publishSpy = jest
      .spyOn(EventRouter, 'publish')
      .mockImplementation(() => Promise.resolve())

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xhash',
      intentId: intent.id,
    })

    // Not an error: the caller asked us to watch a payment for an intent that is
    // already resolved.
    expect(res.isOk()).toBe(true)
    expect(setSpy).toHaveBeenCalled()
    // Nothing rewrites the row from the stale snapshot.
    expect(updateSpy).not.toHaveBeenCalled()
    // But the transaction is still watched. This is exactly when watching matters:
    // a hash submitted for an intent that is already settled describes a second
    // payment, and markIntentAsConfirmed files it. Skipping the publish would drop
    // the only path by which that payment is ever seen.
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'watch-intent-tx' }),
    )
  })

  it('triggerWatchIntent tells the worker to watch Ethereum for a USDC intent', async () => {
    const intent: Intent = {
      id: '0x2-usdc',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      paymentMethod: PaymentMethod.USDC_ETH,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    // The row is claimed before anything is queued, so the task only exists for
    // an intent that was still PENDING.
    jest.spyOn(intentsRepository, 'setTxHashIfPending').mockResolvedValue(true)
    const publishSpy = jest
      .spyOn(EventRouter, 'publish')
      .mockImplementation(() => Promise.resolve())

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xethhash',
      intentId: intent.id,
    })

    expect(res.isOk()).toBe(true)
    // Routed to the Ethereum watcher. Sent to the Auto EVM one it would resolve
    // to nothing at all: an unknown hash is not an error there, it is a receipt
    // that never arrives, so the user's payment would sit unobserved until the
    // next restart swept it up.
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'watch-intent-tx',
        params: {
          txHash: '0xethhash',
          paymentMethod: PaymentMethod.USDC_ETH,
        },
      }),
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
    const confirmSpy = jest
      .spyOn(intentsRepository, 'confirmIntentIfPending')
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
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: intent.id, paymentAmount: 10n }),
    )
    expect(res._unsafeUnwrap().status).toBe(IntentStatus.CONFIRMED)
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

  it('onConfirmedIntent marks a confirmed intent with no deposit FAILED instead of retrying it forever', async () => {
    const intent: Intent = {
      id: '0x10',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: undefined,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.FAILED })

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    // Nothing writes the received-amount column after confirmation, so this can
    // never resolve itself. Returning an error left the row CONFIRMED and
    // _checkConfirmedIntents re-ran it every 30 seconds forever — payment kept,
    // no credits, nothing in the admin queue.
    expect(res.isOk()).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: intent.id, status: IntentStatus.FAILED }),
    )
  })

  it('onConfirmedIntent files the amountless failure too', async () => {
    // FAILED has no listing of its own either way, so the reason the zero-credit
    // path files applies here identically. There is less to go on — no amount, by
    // definition — but the intent and its transaction are enough to look up what
    // arrived.
    const intent: Intent = {
      id: '0xamountless',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: undefined,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.USDC_ETH,
      txHash: '0xarrived',
      fromAddress: '0xpayer',
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockImplementation(async (i) => i)
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    expect(res.isOk()).toBe(true)
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: intent.id,
        reason: IntentMispaymentReason.UNCONVERTIBLE_PAYMENT,
        txHash: '0xarrived',
      }),
    )
  })

  it('onConfirmedIntent files a zero amount rather than dropping it', async () => {
    // Neither receiver can emit a zero, so this is not a reachable case — it is
    // here because the two FAILED branches used to disagree about what a zero
    // means, and a payment must not fall between them.
    const intent: Intent = {
      id: '0xzero-amount',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      shannonsPerByte: 1n,
      paymentMethod: PaymentMethod.AI3_NATIVE,
      paymentAmount: 0n,
      txHash: '0xzero',
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockImplementation(async (i) => i)
    const recordSpy = jest
      .spyOn(intentMispaymentsRepository, 'record')
      .mockResolvedValue(null)

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    expect(res.isOk()).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: IntentStatus.FAILED }),
    )
    // Once, by exactly one of the two branches.
    expect(recordSpy).toHaveBeenCalledTimes(1)
    expect(recordSpy.mock.calls[0][0].reason).toBe(
      IntentMispaymentReason.UNCONVERTIBLE_PAYMENT,
    )
  })

  it('getIntentCredits returns 0 rather than throwing when shannonsPerByte is 0', () => {
    // BigInt division by zero throws, and that exception would escape
    // onConfirmedIntent and abort the whole polling tick rather than just this
    // intent. Reachable via CREDITS_PRICE_MULTIPLIER=0.
    for (const paymentMethod of [
      PaymentMethod.AI3_NATIVE,
      PaymentMethod.USDC_ETH,
    ]) {
      expect(
        IntentsUseCases.getIntentCredits({
          id: '0xzero',
          userPublicId: user.publicId,
          status: IntentStatus.CONFIRMED,
          shannonsPerByte: 0n,
          paymentMethod,
          paymentAmount: 1_000n,
          tokenAmount: 1_000n,
          quotedTokenAmount: 1_000n,
          quotedAi3Shannons: 1_000n,
        }),
      ).toBe(0n)
    }
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

  it('cleanupExpiredIntents asks the repository for rows past the tx grace', async () => {
    // The grace is policy and lives in config; the query only applies it. Passing
    // it explicitly keeps what cleanup reclaims and what isIntentExpired reports
    // as the same set.
    const getSpy = jest
      .spyOn(intentsRepository, 'getExpiredPendingIntents')
      .mockResolvedValue([])

    await IntentsUseCases.cleanupExpiredIntents()

    expect(getSpy).toHaveBeenCalledWith(config.credits.intentTxGraceMinutes)
  })

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
