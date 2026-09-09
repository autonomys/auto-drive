import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from '@jest/globals'
import {
  IntentStatus,
  PaymentMethod,
  UserRole,
  type UserWithOrganization,
} from '@auto-drive/models'
import { IntentsUseCases } from '../../src/core/users/intents.js'
import {
  UsdcPaymentsUseCases,
  _resetThresholds,
} from '../../src/core/payments/usdc.js'
import { withUsdcAvailability } from '../../src/core/featureFlags/express.js'
import { FeatureFlagsUseCases } from '../../src/core/featureFlags/index.js'
import { usdcGatesJob } from '../../src/infrastructure/services/usdcGatesJob.js'
import { usdcPaymentStateRepository } from '../../src/infrastructure/repositories/usdcPaymentState.js'
import { intentsRepository } from '../../src/infrastructure/repositories/users/intents.js'
import { AccountsUseCases } from '../../src/core/users/accounts.js'
import { purchasedCreditsRepository } from '../../src/infrastructure/repositories/users/purchasedCredits.js'
import { priceOracle } from '../../src/infrastructure/services/priceOracle/index.js'
import { slackNotifier } from '../../src/infrastructure/services/slack/index.js'
import {
  ServiceUnavailableError,
  UsdcUnavailableError,
} from '../../src/errors/index.js'
import { config } from '../../src/config.js'
import { dbMigration } from '../utils/dbMigrate.js'
import { getDatabase } from '../../src/infrastructure/drivers/pg.js'
import { ok } from 'neverthrow'

// The gates end to end, against the migrated database.
//
// Every other spec for this feature mocks one side of the boundary: the use-case
// spec stubs the repository, the job spec stubs the chain, the repository spec
// exercises SQL with no use case above it. None of them can fail if the pieces
// are wired to each other wrongly — a key typo, a snapshot shape the reader does
// not recognise, an availability read that never sees what the poller wrote.
//
// This one runs the real poller against the real tables and then asks the real
// question: can a user buy storage with USDC right now.
describe('USDC gates (integration)', () => {
  const RECEIVER = '0x1111111111111111111111111111111111111111'
  const USDC = 1_000_000n
  const ethereumDefaults = { ...config.ethereum }
  const usdcDefaults = { ...config.usdcPayments }
  const usdcFlag = config.featureFlags.flags.payWithUsdc
  const usdcFlagDefault = usdcFlag.active

  const admin = {
    id: 'u-admin',
    publicId: 'admin-int-1',
    oauthProvider: 'google',
    oauthUsername: 'admin@autonomys.xyz',
    role: UserRole.Admin,
    organizationId: 'org-1',
  } as unknown as UserWithOrganization

  const buyer = {
    ...admin,
    id: 'u-buyer',
    publicId: 'buyer-int-1',
    role: UserRole.User,
  } as unknown as UserWithOrganization

  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    usdcGatesJob.stop()
    await dbMigration.down()
  })

  beforeEach(async () => {
    jest.restoreAllMocks()
    _resetThresholds()
    usdcGatesJob._resetAlertState()

    config.ethereum.rpcUrl = 'http://example.org'
    config.ethereum.usdcReceiverAddress = RECEIVER
    config.ethereum.usdcTokenAddress =
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    config.usdcPayments.treasuryAddresses = []
    config.usdcPayments.enabledByDefault = false
    usdcFlag.active = true

    jest.spyOn(slackNotifier, 'send').mockResolvedValue(true)
    jest.spyOn(usdcGatesJob._internal, 'sendMetric').mockResolvedValue()
    // Everything outside these gates: a per-byte price, an account with headroom,
    // and a rate to quote at.
    jest
      .spyOn(IntentsUseCases, 'getPrice')
      .mockResolvedValue({ price: 1, pricePerGB: 1073741824 })
    jest
      .spyOn(AccountsUseCases, 'getOrCreateAccount')
      .mockResolvedValue({ id: 'acc-int-1' } as never)
    jest
      .spyOn(purchasedCreditsRepository, 'getRemainingCredits')
      .mockResolvedValue({
        uploadBytesRemaining: 0n,
        uploadBytesOriginal: 0n,
        downloadBytesRemaining: 0n,
        nextExpiryDate: null,
        activeRowCount: 0,
      } as never)
    jest.spyOn(priceOracle, 'getPrice').mockResolvedValue(
      ok({
        usdPerAi3: 6_400_000_000_000_000n,
        asOf: new Date(),
        fromCache: false,
        stale: false,
      }),
    )
    jest.spyOn(priceOracle, 'getHealth').mockReturnValue({
      lastSuccessAt: new Date(),
      lastFailureAt: null,
      lastFailureReason: null,
      window: null,
      servingStale: false,
    })
    jest.spyOn(usdcGatesJob._internal, 'readRate').mockResolvedValue(
      ok({
        usdPerAi3: 6_400_000_000_000_000n,
        asOf: new Date(),
        fromCache: false,
        stale: false,
      }),
    )

    // A clean slate for both tables, so ordering between cases cannot matter.
    const db = await getDatabase()
    await db.query('DELETE FROM usdc_gate_readings')
    await db.query('DELETE FROM usdc_payment_switch')
  })

  const buy = () =>
    IntentsUseCases.createIntent(buyer, {
      requestedBytes: 1024n,
      paymentMethod: PaymentMethod.USDC_ETH,
    })

  const poll = async (balance: bigint) => {
    jest
      .spyOn(usdcGatesJob._internal, 'readBalance')
      .mockResolvedValue(balance)
    await usdcGatesJob._runCheck()
  }

  it('refuses a purchase until an admin opens the switch, then allows it', async () => {
    // The gate is closed by default, and the poller having run changes nothing:
    // the manual switch is the deployment's own decision.
    await poll(10n * USDC)

    const refused = await buy()
    expect(refused.isErr()).toBe(true)
    expect(refused._unsafeUnwrapErr()).toBeInstanceOf(ServiceUnavailableError)

    const flip = await UsdcPaymentsUseCases.setManualGate(admin, true)
    expect(flip._unsafeUnwrap()).toEqual({ changed: true })

    // The oracle row is written by the poll that follows the flip — before that,
    // the rate has never been observed, which fails closed.
    const beforeRate = await buy()
    expect(beforeRate.isErr()).toBe(true)

    await poll(10n * USDC)

    const allowed = await buy()
    expect(allowed.isOk()).toBe(true)
    const intent = allowed._unsafeUnwrap()
    expect(intent.paymentMethod).toBe(PaymentMethod.USDC_ETH)
    expect(intent.status).toBe(IntentStatus.PENDING)
    expect(intent.quotedTokenAmount).toBeGreaterThan(0n)

    // And what the client is told matches what it just got.
    const flags = await withUsdcAvailability(FeatureFlagsUseCases.get(buyer))
    expect(flags.payWithUsdc).toBe(true)
    expect(flags.usdcAvailable).toBe(true)
  })

  it('closes the path when a poll finds the treasury over its cap', async () => {
    await UsdcPaymentsUseCases.setManualGate(admin, true)
    await poll(10n * USDC)
    expect((await buy()).isOk()).toBe(true)

    // The balance the poller reads is the whole of the decision — no other state
    // changes hands between the two processes.
    await poll(5000n * USDC)

    const refused = await buy()
    expect(refused.isErr()).toBe(true)
    // The refusal reaches the buyer with a code and a generic sentence, NOT with
    // the gate that closed. The treasury's balance and its cap are the
    // deployment's business: they are in the log line beside this refusal and on
    // the admin dashboard, and putting them in a 503 published them to anyone who
    // clicked Buy. See UsdcUnavailableError.
    expect(refused._unsafeUnwrapErr()).toBeInstanceOf(UsdcUnavailableError)
    expect(refused._unsafeUnwrapErr().message).not.toContain('cap')
    expect(refused._unsafeUnwrapErr().message).toContain('Pay in AI3')

    // No cache in between, so the advertisement cannot lag the refusal.
    const flags = await withUsdcAvailability(FeatureFlagsUseCases.get(buyer))
    expect(flags.payWithUsdc).toBe(false)

    // ...and it reopens on its own once a conversion brings the balance down.
    await poll(10n * USDC)
    expect((await buy()).isOk()).toBe(true)
  })

  it('closes the path when the admin switch is flipped back, and stays closed', async () => {
    await UsdcPaymentsUseCases.setManualGate(admin, true)
    await poll(10n * USDC)
    expect((await buy()).isOk()).toBe(true)

    await UsdcPaymentsUseCases.setManualGate(admin, false)
    expect((await buy()).isErr()).toBe(true)

    // Latching: a poll that finds everything healthy must not reopen a switch a
    // person closed.
    await poll(10n * USDC)
    expect((await buy()).isErr()).toBe(true)

    const gate = await UsdcPaymentsUseCases.getManualGate()
    expect(gate.enabled).toBe(false)
    expect(gate.updatedBy).toBe('admin-int-1')
  })

  it('keeps the history of who flipped the switch, and when', async () => {
    await UsdcPaymentsUseCases.setManualGate(admin, true)
    await UsdcPaymentsUseCases.setManualGate(admin, false)

    const history = await usdcPaymentStateRepository.getSwitchHistory()
    // The switch's table IS its audit trail — the current value and the history
    // are the same fact, so there is no second table to keep in step and no flip
    // that a later one can overwrite.
    expect(history.map((entry) => [entry.enabled, entry.setBy])).toEqual([
      [false, 'admin-int-1'],
      [true, 'admin-int-1'],
    ])
  })

  it('records nothing in that history when the poller runs', async () => {
    await UsdcPaymentsUseCases.setManualGate(admin, true)
    await poll(10n * USDC)

    // 288 machine writes a day would bury the handful of entries anyone reads —
    // and structurally the poller cannot write this table at all.
    expect(await usdcPaymentStateRepository.getSwitchHistory()).toHaveLength(1)
  })

  it('never lets a stale reading keep the path open', async () => {
    await UsdcPaymentsUseCases.setManualGate(admin, true)
    await poll(10n * USDC)
    expect((await buy()).isOk()).toBe(true)

    // Age both readings past the max-stale window, exactly as an outage would.
    const db = await getDatabase()
    await db.query(
      `UPDATE usdc_gate_readings SET
         treasury_checked_at = NOW() - interval '2 hours',
         oracle_checked_at = NOW() - interval '2 hours'`,
    )

    const refused = await buy()
    expect(refused.isErr()).toBe(true)
    expect(refused._unsafeUnwrapErr()).toBeInstanceOf(ServiceUnavailableError)
  })

  it('credits a payment that arrives while every gate is closed', async () => {
    // The acceptance criterion that matters most: the gates block CREATION, and
    // nothing else. A user who paid always gets credits.
    await UsdcPaymentsUseCases.setManualGate(admin, true)
    await poll(10n * USDC)
    const intent = (await buy())._unsafeUnwrap()

    // Now shut everything: the switch off AND the treasury over its cap.
    await UsdcPaymentsUseCases.setManualGate(admin, false)
    await poll(5000n * USDC)
    expect((await buy()).isErr()).toBe(true)

    const confirmed = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      tokenAmount: intent.quotedTokenAmount,
      txHash: '0xdeadbeef',
      logIndex: 0,
    })
    expect(confirmed.isOk()).toBe(true)

    const stored = await intentsRepository.getById(intent.id)
    expect(stored?.status).toBe(IntentStatus.CONFIRMED)
    expect(stored?.tokenAmount).toBe(intent.quotedTokenAmount)

    // CONFIRMED is not the acceptance criterion — #752 calls a paid-while-paused
    // intent "the failure that costs real money", and what costs money is
    // credits not being granted. Confirmation only records what arrived; the
    // grant happens when the polling loop reaches the intent, so drive that too
    // and assert the money side rather than the status.
    const addCredits = jest
      .spyOn(AccountsUseCases, 'addCreditsToAccount')
      .mockResolvedValue(ok(undefined) as never)

    const pending = await IntentsUseCases.getConfirmedIntents()
    expect(pending.map((row) => row.id)).toContain(intent.id)

    const credited = await IntentsUseCases.onConfirmedIntent(intent.id)
    expect(credited.isOk()).toBe(true)

    expect(addCredits).toHaveBeenCalledTimes(1)
    const [publicId, creditBytes] = addCredits.mock.calls[0]
    expect(publicId).toBe(buyer.publicId)
    expect(creditBytes).toBeGreaterThan(0n)

    const settled = await intentsRepository.getById(intent.id)
    expect(settled?.status).toBe(IntentStatus.COMPLETED)
  })

  afterAll(() => {
    Object.assign(config.ethereum, ethereumDefaults)
    Object.assign(config.usdcPayments, usdcDefaults)
    usdcFlag.active = usdcFlagDefault
  })
})
