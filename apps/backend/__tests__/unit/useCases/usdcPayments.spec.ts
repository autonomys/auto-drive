import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import {
  UsdcClosedReason,
  UsdcManualGateSource,
  UserRole,
  type User,
} from '@auto-drive/models'
import {
  UsdcPaymentsUseCases,
  _resetThresholds,
} from '../../../src/core/payments/usdc.js'
import {
  usdcPaymentStateRepository,
  type GateReadings,
  type SwitchEntry,
} from '../../../src/infrastructure/repositories/usdcPaymentState.js'
import { slackNotifier } from '../../../src/infrastructure/services/slack/index.js'
import { priceOracle } from '../../../src/infrastructure/services/priceOracle/index.js'
import { config } from '../../../src/config.js'
import { usdcChainGuard } from '../../../src/infrastructure/services/paymentManager/usdcChainGuard.js'
import { ForbiddenError } from '../../../src/errors/index.js'

const makeUser = (role: UserRole = UserRole.User): User =>
  ({
    id: 'u1',
    publicId: role === UserRole.Admin ? 'admin-1' : 'user-1',
    oauthProvider: 'google',
    oauthUsername: 'someone@example.com',
    role,
  }) as unknown as User

const admin = makeUser(UserRole.Admin)
const plainUser = makeUser()

const switchEntry = (enabled: boolean, setBy = 'admin-1'): SwitchEntry => ({
  enabled,
  setBy,
  setAt: new Date(),
})

// A reading at an age the caller chooses — the age is what decides whether it is
// still usable, and in production it is computed by Postgres.
const treasuryReading = (
  balanceBaseUnits: bigint,
  paused: boolean,
  ageMs = 0,
) => ({
  balanceBaseUnits,
  paused,
  addresses: ['0x1111111111111111111111111111111111111111'],
  checkedAt: new Date(Date.now() - ageMs),
  ageMs,
})

const oracleReading = (healthy: boolean, ageMs = 0, servingStale = false) => ({
  healthy,
  reason: healthy ? null : 'thin-liquidity',
  servingStale,
  usdPerAi3: healthy ? 6_400_000_000_000_000n : null,
  window: null,
  checkedAt: new Date(Date.now() - ageMs),
  ageMs,
})

const OPEN_TREASURY = treasuryReading(1_000_000n, false)
const HEALTHY_ORACLE = oracleReading(true)

describe('UsdcPaymentsUseCases', () => {
  const ethereumDefaults = { ...config.ethereum }
  const usdcDefaults = { ...config.usdcPayments }
  const paymentManagerDefaults = { ...config.paymentManager }

  // The two reads a gate evaluation makes. Typed, so a case states what the
  // poller observed rather than what JSON it left behind.
  const mockState = (
    state: {
      switch?: SwitchEntry | null
      treasury?: GateReadings['treasury']
      oracle?: GateReadings['oracle']
    } = {},
  ) => {
    const getSwitch = jest
      .spyOn(usdcPaymentStateRepository, 'getSwitch')
      .mockResolvedValue(state.switch ?? null)
    jest.spyOn(usdcPaymentStateRepository, 'getReadings').mockResolvedValue({
      treasury: state.treasury ?? null,
      oracle: state.oracle ?? null,
    })
    return getSwitch
  }

  // Everything open, for the cases that are about one gate closing.
  const allOpen = (overrides: Parameters<typeof mockState>[0] = {}) =>
    mockState({
      switch: switchEntry(true),
      treasury: OPEN_TREASURY,
      oracle: HEALTHY_ORACLE,
      ...overrides,
    })

  beforeEach(() => {
    jest.clearAllMocks()
    _resetThresholds()
    // The chain guard is process-global and fails the path closed once a
    // mismatch is verified. Nothing here verifies one, so it must not carry a
    // verdict in from another case.
    usdcChainGuard._reset()
    // A complete Ethereum configuration: .env.test sets none of these, and
    // without them every case would stop at NOT_CONFIGURED.
    config.ethereum.rpcUrl = 'http://example.org'
    config.ethereum.usdcReceiverAddress =
      '0x1111111111111111111111111111111111111111'
    config.ethereum.usdcTokenAddress =
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    config.usdcPayments.enabledByDefault = false
    jest.spyOn(slackNotifier, 'send').mockResolvedValue(true)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    _resetThresholds()
    usdcChainGuard._reset()
    Object.assign(config.ethereum, ethereumDefaults)
    Object.assign(config.usdcPayments, usdcDefaults)
    Object.assign(config.paymentManager, paymentManagerDefaults)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // getAvailability — the truth table
  // ──────────────────────────────────────────────────────────────────────────

  describe('getAvailability', () => {
    it('is open when configured, switched on, under the cap and priceable', async () => {
      allOpen()
      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: true,
      })
    })

    it('reports NOT_CONFIGURED without reading the database at all', async () => {
      config.ethereum.usdcReceiverAddress = undefined
      const getSwitch = allOpen()

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.NOT_CONFIGURED,
      })
      // The cheapest gate first: a deployment that does not sell USDC should not
      // pay for a query on every page load.
      expect(getSwitch).not.toHaveBeenCalled()
    })

    it('reports NOT_CONFIGURED on a half-configured deployment', async () => {
      // The receiver alone is not enough — the watcher refuses to build on a
      // partial configuration, and the quote side has to agree with it.
      config.ethereum.usdcTokenAddress = undefined
      allOpen()

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.NOT_CONFIGURED,
      })
    })

    it('reports MANUAL_OFF when an admin has closed the switch', async () => {
      allOpen({ switch: switchEntry(false) })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.MANUAL_OFF,
      })
    })

    it('reports MANUAL_OFF ahead of the other gates', async () => {
      // Precedence matters for what an operator does next: "I turned it off" and
      // "convert some USDC" are different actions, and the switch is the one that
      // will still be closed after the others are fixed.
      mockState({
        switch: switchEntry(false),
        treasury: treasuryReading(9_999_000_000n, true),
        oracle: oracleReading(false),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.MANUAL_OFF,
      })
    })

    it('reports TREASURY_CAP when the poller has paused the gate', async () => {
      allOpen({ treasury: treasuryReading(2_014_000_000n, true) })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.TREASURY_CAP,
      })
    })

    it('fails closed with BALANCE_UNKNOWN when nothing has ever polled', async () => {
      // Cold start, or a payment worker that was never deployed. Distinguished
      // from "0 USDC held" deliberately: the dashboard must not claim an
      // observation it does not have.
      allOpen({ treasury: null })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.BALANCE_UNKNOWN,
      })
    })

    it('fails closed when the balance reading is older than the stale window', async () => {
      allOpen({
        treasury: treasuryReading(
          1n,
          false,
          config.usdcPayments.balanceMaxStaleMs + 1,
        ),
      })

      // An open gate from a reading nobody has refreshed is not evidence: the
      // balance may have crossed the cap an hour ago. An Ethereum outage must not
      // become a way to keep selling.
      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.BALANCE_UNKNOWN,
      })
    })

    it('accepts a reading exactly on the stale boundary', async () => {
      allOpen({
        treasury: treasuryReading(
          1n,
          false,
          config.usdcPayments.balanceMaxStaleMs,
        ),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: true,
      })
    })

    it('reports BALANCE_UNKNOWN ahead of TREASURY_CAP for a stale pause', async () => {
      // Both would refuse, but only one is actionable by converting USDC. The
      // other means the worker cannot reach Ethereum.
      allOpen({
        treasury: treasuryReading(
          9_999_000_000n,
          true,
          config.usdcPayments.balanceMaxStaleMs * 2,
        ),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.BALANCE_UNKNOWN,
      })
    })

    it('reports ORACLE_UNAVAILABLE when the last rate read refused', async () => {
      allOpen({ oracle: oracleReading(false) })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.ORACLE_UNAVAILABLE,
      })
    })

    it('fails closed when no rate has been read yet', async () => {
      // The rate is only re-read while the switch is on, so this is the state
      // immediately after an admin opens it — closed for at most one poll.
      allOpen({ oracle: null })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.ORACLE_UNAVAILABLE,
      })
    })

    it('fails closed on a stale rate, however healthy it was', async () => {
      allOpen({
        oracle: oracleReading(true, config.usdcPayments.balanceMaxStaleMs + 1),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.ORACLE_UNAVAILABLE,
      })
    })

    it('fails closed when the poller could only serve its last good rate', async () => {
      // A FRESH row, and healthy — but the poller reached that verdict from its
      // own in-memory fallback rather than from the subgraph. That fallback is
      // per-process: an API replica started during the outage has none, and
      // createIntent calls priceOracle.getPrice() directly, so it would 503 on
      // a path this gate had advertised as open.
      allOpen({ oracle: oracleReading(true, 0, true) })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.ORACLE_UNAVAILABLE,
      })
    })

    it('opens on a rate the poller actually read', async () => {
      // The other half: servingStale false is the live read, and it opens. The
      // check above must not have closed the ordinary case with it.
      allOpen({ oracle: oracleReading(true, 0, false) })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: true,
      })
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // The manual gate's default, and what supersedes it
  // ──────────────────────────────────────────────────────────────────────────

  describe('getManualGate', () => {
    it('falls back to the environment default when nobody has flipped it', async () => {
      config.usdcPayments.enabledByDefault = true
      mockState({ switch: null })

      const gate = await UsdcPaymentsUseCases.getManualGate()
      expect(gate.enabled).toBe(true)
      expect(gate.source).toBe(UsdcManualGateSource.ENV_DEFAULT)
      expect(gate.updatedBy).toBeNull()
      expect(gate.updatedAt).toBeNull()
    })

    it('lets a recorded flip win over the environment default', async () => {
      // The env var is a BOOT default and nothing more. Reporting the source is
      // what stops an operator from changing it in production and waiting for
      // something to happen.
      config.usdcPayments.enabledByDefault = true
      mockState({ switch: switchEntry(false, 'admin-9') })

      const gate = await UsdcPaymentsUseCases.getManualGate()
      expect(gate.enabled).toBe(false)
      expect(gate.source).toBe(UsdcManualGateSource.ADMIN)
      expect(gate.updatedBy).toBe('admin-9')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // setManualGate — authorisation, attribution, idempotence, alerting
  // ──────────────────────────────────────────────────────────────────────────

  describe('setManualGate', () => {
    it('refuses a non-admin without writing anything', async () => {
      const setSpy = jest.spyOn(usdcPaymentStateRepository, 'setSwitch')

      const result = await UsdcPaymentsUseCases.setManualGate(plainUser, false)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
      expect(setSpy).not.toHaveBeenCalled()
    })

    it('attributes the flip to the admin who made it', async () => {
      const setSpy = jest
        .spyOn(usdcPaymentStateRepository, 'setSwitch')
        .mockResolvedValue(null)

      await UsdcPaymentsUseCases.setManualGate(admin, true)

      expect(setSpy).toHaveBeenCalledWith(true, 'admin-1')
    })

    it('alerts on a real transition', async () => {
      jest
        .spyOn(usdcPaymentStateRepository, 'setSwitch')
        .mockResolvedValue(switchEntry(true, 'admin-2'))
      const slackSpy = jest.spyOn(slackNotifier, 'send')

      const result = await UsdcPaymentsUseCases.setManualGate(admin, false)

      expect(result._unsafeUnwrap()).toEqual({ changed: true })
      expect(slackSpy).toHaveBeenCalledTimes(1)
      expect(slackSpy.mock.calls[0][0].title).toContain('DISABLED')
      expect(slackSpy.mock.calls[0][0].title).toContain('admin-1')
    })

    it('does not alert when the gate already held that value', async () => {
      // A dashboard toggle that posts to Slack on every click is a dashboard
      // whose channel gets muted.
      jest
        .spyOn(usdcPaymentStateRepository, 'setSwitch')
        .mockResolvedValue(switchEntry(false, 'admin-2'))
      const slackSpy = jest.spyOn(slackNotifier, 'send')

      const result = await UsdcPaymentsUseCases.setManualGate(admin, false)

      expect(result._unsafeUnwrap()).toEqual({ changed: false })
      expect(slackSpy).not.toHaveBeenCalled()
    })

    it('compares the first flip against the environment default', async () => {
      // Nothing recorded yet, and the env default already said "on": writing
      // "on" is not a change and should not announce itself as one.
      config.usdcPayments.enabledByDefault = true
      jest
        .spyOn(usdcPaymentStateRepository, 'setSwitch')
        .mockResolvedValue(null)
      const slackSpy = jest.spyOn(slackNotifier, 'send')

      const result = await UsdcPaymentsUseCases.setManualGate(admin, true)

      expect(result._unsafeUnwrap()).toEqual({ changed: false })
      expect(slackSpy).not.toHaveBeenCalled()
    })

    it('treats the first flip against a false default as a change', async () => {
      config.usdcPayments.enabledByDefault = false
      jest
        .spyOn(usdcPaymentStateRepository, 'setSwitch')
        .mockResolvedValue(null)
      const slackSpy = jest.spyOn(slackNotifier, 'send')

      const result = await UsdcPaymentsUseCases.setManualGate(admin, true)

      expect(result._unsafeUnwrap()).toEqual({ changed: true })
      expect(slackSpy.mock.calls[0][0].title).toContain('ENABLED')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Thresholds
  // ──────────────────────────────────────────────────────────────────────────

  describe('getThresholds', () => {
    it('treats an unset resume threshold as "no hysteresis"', () => {
      // `.env.sample` ships this key blank and dotenv parses `KEY=` to '', which
      // is not undefined — so config normalises it. Parsed instead, that empty
      // string failed, the gates job refused to start, and USDC stayed closed on
      // any deployment configured the documented way.
      config.usdcPayments.resumeThresholdUsdc = undefined
      _resetThresholds()

      const { pause, resume } = UsdcPaymentsUseCases.getThresholds()
      expect(resume).toBe(pause)
    })

    it('parses a configured resume threshold below the cap', () => {
      config.usdcPayments.pauseThresholdUsdc = '2000'
      config.usdcPayments.resumeThresholdUsdc = '1500'
      _resetThresholds()

      const { pause, resume } = UsdcPaymentsUseCases.getThresholds()
      expect(pause).toBe(2_000_000_000n)
      expect(resume).toBe(1_500_000_000n)
    })

    it('refuses a resume threshold above the cap', () => {
      config.usdcPayments.pauseThresholdUsdc = '1000'
      config.usdcPayments.resumeThresholdUsdc = '2000'
      _resetThresholds()

      // Not merely wrong: above resume it pauses and below pause it resumes, so
      // a balance between the two flips the gate on every poll.
      expect(() => UsdcPaymentsUseCases.getThresholds()).toThrow(
        'must be <= USDC_TREASURY_PAUSE_THRESHOLD',
      )
    })

    it('names the variable when a threshold cannot be parsed', () => {
      config.usdcPayments.pauseThresholdUsdc = '2,000'
      _resetThresholds()

      expect(() => UsdcPaymentsUseCases.getThresholds()).toThrow(
        'USDC_TREASURY_PAUSE_THRESHOLD',
      )
    })

    it('describes a capped treasury without the figure when the cap is unreadable', () => {
      // This sentence reaches a user inside a 503. An unparseable cap must not
      // turn a refusal into an exception.
      config.usdcPayments.pauseThresholdUsdc = '2,000'
      _resetThresholds()

      expect(() =>
        UsdcPaymentsUseCases.describeClosedReason(
          UsdcClosedReason.TREASURY_CAP,
        ),
      ).not.toThrow()
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // getStatus — the dashboard's whole answer
  // ──────────────────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('refuses a non-admin', async () => {
      const result = await UsdcPaymentsUseCases.getStatus(plainUser)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('reports the balance, the headroom and who set the switch', async () => {
      allOpen({
        switch: switchEntry(true, 'admin-7'),
        treasury: treasuryReading(1_500_000_000n, false, 30_000),
      })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.availability).toEqual({ open: true })
      expect(status.configured).toBe(true)
      expect(status.manualGate.updatedBy).toBe('admin-7')
      expect(status.manualGate.source).toBe(UsdcManualGateSource.ADMIN)
      expect(status.treasury.balanceBaseUnits).toBe('1500000000')
      // 2000 USDC cap - 1500 held. The number an operator actually wants.
      expect(status.treasury.headroomBaseUnits).toBe('500000000')
      expect(status.treasury.stale).toBe(false)
      expect(status.oracle.healthy).toBe(true)
    })

    it('reports a negative headroom once the cap is exceeded', async () => {
      allOpen({ treasury: treasuryReading(2_014_000_000n, true) })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()
      // How far over, which is the conversion size.
      expect(status.treasury.headroomBaseUnits).toBe('-14000000')
    })

    it('says paused-and-stale rather than paused, when nothing has polled', async () => {
      allOpen({ treasury: null })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.treasury.paused).toBe(true)
      // The pair is what stops the dashboard printing "auto-paused: 0.00 USDC
      // held" — a sentence an operator would rightly disbelieve.
      expect(status.treasury.stale).toBe(true)
      expect(status.treasury.balanceBaseUnits).toBeNull()
      expect(status.treasury.checkedAt).toBeNull()
      // Falls back to the configured set so the dashboard can still say what
      // WOULD be watched.
      expect(status.treasury.addresses).toEqual([
        '0x1111111111111111111111111111111111111111',
      ])
    })

    it('reports the oracle refusal the poller recorded', async () => {
      allOpen({ oracle: oracleReading(false) })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.oracle.healthy).toBe(false)
      expect(status.oracle.reason).toBe('thin-liquidity')
      // And the composite is closed on it: a path whose every quote would 503
      // must not be advertised as open.
      expect(status.availability).toEqual({
        open: false,
        closedReason: UsdcClosedReason.ORACLE_UNAVAILABLE,
      })
    })

    it('reads no rate of its own', async () => {
      allOpen()
      const priceSpy = jest.spyOn(priceOracle, 'getPrice')

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      // Every figure comes from the rows the gates are evaluated from, so the
      // dashboard cannot disagree with the refusal a user just got — and an
      // admin refreshing a page cannot spend on The Graph.
      expect(priceSpy).not.toHaveBeenCalled()
      expect(status.oracle.usdPerAi3).toBe('6400000000000000')
    })

    it('says the rate is unknown rather than broken when nothing has polled', async () => {
      allOpen({ oracle: null })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.oracle.stale).toBe(true)
      expect(status.oracle.healthy).toBe(false)
      expect(status.oracle.reason).toBeNull()
    })

    it('renders rather than 500s when the cap cannot be parsed', async () => {
      // A malformed threshold already stops the poller, so the path is shut —
      // and this is the page an operator opens to find out why, with the kill
      // switch on it.
      config.usdcPayments.pauseThresholdUsdc = '2,000'
      _resetThresholds()
      allOpen({ switch: switchEntry(true, 'a-1') })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.treasury.thresholdError).toContain(
        'USDC_TREASURY_PAUSE_THRESHOLD',
      )
      expect(status.treasury.pauseThresholdBaseUnits).toBeNull()
      expect(status.treasury.headroomBaseUnits).toBeNull()
      // The switch and its attribution still render — that is the point.
      expect(status.manualGate.enabled).toBe(true)
      expect(status.manualGate.updatedBy).toBe('a-1')
    })

    it('renders rather than 500s when the address list is unusable', async () => {
      config.usdcPayments.treasuryAddresses = ['not-an-address']
      allOpen({ treasury: null })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.treasury.addressError).toContain('USDC_TREASURY_ADDRESSES')
      expect(status.treasury.addresses).toEqual([])
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // treasuryAddresses
  // ──────────────────────────────────────────────────────────────────────────

  describe('treasuryAddresses', () => {
    it('watches the receiver when nothing else is configured', () => {
      config.usdcPayments.treasuryAddresses = []
      expect(UsdcPaymentsUseCases.treasuryAddresses()).toEqual([
        '0x1111111111111111111111111111111111111111',
      ])
    })

    it('always includes the receiver, even when a list is configured', () => {
      // The failure this prevents: reading the variable the obvious way and
      // setting it to the sweep destination alone would stop counting the address
      // payments actually land in, so the cap would never bind.
      config.usdcPayments.treasuryAddresses = [
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      ]
      expect(UsdcPaymentsUseCases.treasuryAddresses()).toEqual([
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0x1111111111111111111111111111111111111111',
      ])
    })

    it('accepts an all-uppercase address', () => {
      // viem's isAddress rejects this under its default strict:true, and a
      // dropped address counts as a ZERO balance — so the cap would be measured
      // over the rest and the treasury could hold arbitrarily more than
      // configured. getAddress accepts every casing a valid address can take.
      config.usdcPayments.treasuryAddresses = [
        '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      ]
      expect(UsdcPaymentsUseCases.treasuryAddresses()).toContain(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      )
    })

    it('de-duplicates the receiver written a second way', () => {
      config.usdcPayments.treasuryAddresses = [
        '0x1111111111111111111111111111111111111111',
      ]
      expect(UsdcPaymentsUseCases.treasuryAddresses()).toEqual([
        '0x1111111111111111111111111111111111111111',
      ])
    })

    it('throws on an unusable entry rather than dropping it', () => {
      // Dropping it would shrink the sum silently. Throwing closes the gate,
      // which is the safe direction and the loud one.
      config.usdcPayments.treasuryAddresses = ['0xnope']
      expect(() => UsdcPaymentsUseCases.treasuryAddresses()).toThrow(
        'USDC_TREASURY_ADDRESSES',
      )
    })

    it('is empty when nothing is configured and there is no receiver', () => {
      config.usdcPayments.treasuryAddresses = []
      config.ethereum.usdcReceiverAddress = undefined
      // Summing an empty list to zero would report an empty treasury and hold the
      // gate open on no evidence at all, so the poller refuses instead.
      expect(UsdcPaymentsUseCases.treasuryAddresses()).toEqual([])
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // getPaymentTarget — what the purchase flow is told to pay, and where
  // ──────────────────────────────────────────────────────────────────────────

  describe('getPaymentTarget', () => {
    it('reports the chain, receiver, token and confirmation depth', () => {
      config.ethereum.chainId = 11155111
      config.ethereum.confirmations = 4

      expect(UsdcPaymentsUseCases.getPaymentTarget()).toEqual({
        chainId: 11155111,
        receiverAddress: '0x1111111111111111111111111111111111111111',
        tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenDecimals: 6,
        confirmations: 4,
        settleGraceMs: config.paymentManager.checkInterval * 4,
      })
    })

    it('checksums the addresses it reports', () => {
      // The buyer's wallet is about to show them a spender address next to this
      // one. Two spellings of the same address on a confirmation screen is how a
      // careful person talks themselves out of a legitimate payment.
      config.ethereum.usdcTokenAddress =
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

      expect(UsdcPaymentsUseCases.getPaymentTarget()?.tokenAddress).toBe(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      )
    })

    it('is null when the deployment has no complete Ethereum configuration', () => {
      config.ethereum.rpcUrl = undefined
      expect(UsdcPaymentsUseCases.getPaymentTarget()).toBeNull()
    })

    it('is null when the endpoint is verified to be a different chain', () => {
      // The one availability-shaped condition the target DOES refuse on, and
      // the exception proves the rule below. Every other closed gate leaves the
      // target correct; this one means the target itself is wrong, and serving
      // it sends a buyer's approval to a chain nothing here watches.
      jest.spyOn(usdcChainGuard, 'isMismatched').mockReturnValue(true)
      expect(UsdcPaymentsUseCases.getPaymentTarget()).toBeNull()
    })

    it('reports a grace derived from the credit-granting interval', () => {
      // Served rather than compiled into the client, because it is a property
      // of THIS backend's timing: a 410 from GET /intents/:id means the lock
      // lapsed, not that credits are withheld, and how long a client should
      // poll through it is a multiple of the poller below. A frontend constant
      // would start calling credited purchases lost the day this changed.
      config.paymentManager.checkInterval = 45_000
      expect(UsdcPaymentsUseCases.getPaymentTarget()?.settleGraceMs).toBe(
        180_000,
      )
    })

    it('still reports the target while every gate is shut', async () => {
      // Deliberately NOT gated on availability. A client holding a quoted intent
      // still has ten minutes to pay it, and the payment is still owed to the
      // same contract — so losing the address the moment the treasury hits its
      // cap would strand a purchase that the backend would have credited.
      mockState({ switch: switchEntry(false) })
      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.MANUAL_OFF,
      })

      expect(UsdcPaymentsUseCases.getPaymentTarget()).not.toBeNull()
    })

    it('reports 6 decimals regardless of what any token claims', () => {
      // Every amount downstream assumes 6, and the watcher refuses a payment in
      // any other token precisely so that holds. Reporting anything else would
      // advertise a purchase this deployment would then refuse to credit.
      expect(UsdcPaymentsUseCases.getPaymentTarget()?.tokenDecimals).toBe(6)
    })
  })
})
