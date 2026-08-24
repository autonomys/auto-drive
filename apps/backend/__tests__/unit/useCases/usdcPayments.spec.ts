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
  RuntimeSettingKey,
  runtimeSettingsRepository,
  type RuntimeSetting,
} from '../../../src/infrastructure/repositories/runtimeSettings.js'
import { slackNotifier } from '../../../src/infrastructure/services/slack/index.js'
import { priceOracle } from '../../../src/infrastructure/services/priceOracle/index.js'
import { config } from '../../../src/config.js'
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

// A stored setting, at an age the caller chooses — the age is what decides
// whether a treasury reading is still usable, and it comes from Postgres in
// production.
const setting = <T>(value: T, ageMs = 0, updatedBy: string | null = null) =>
  ({
    value,
    updatedBy,
    updatedAt: new Date(Date.now() - ageMs),
    ageMs,
  }) as RuntimeSetting<T>

const FRESH_OPEN_TREASURY = setting({
  balanceBaseUnits: '1000000',
  paused: false,
  addresses: ['0x1111111111111111111111111111111111111111'],
})

describe('UsdcPaymentsUseCases', () => {
  const ethereumDefaults = { ...config.ethereum }
  const enabledByDefault = config.usdcPayments.enabledByDefault

  // Reads are routed per key: almost every case cares about one gate and needs
  // the others out of the way. Both accessors are stubbed because the composite
  // reads all three keys in one round trip while the per-gate accessors (used by
  // the status endpoint) read one at a time.
  const mockSettings = (
    settings: Partial<Record<string, RuntimeSetting<unknown> | null>>,
  ) => {
    const get = jest
      .spyOn(runtimeSettingsRepository, 'get')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(async (key: string) => (settings[key] ?? null) as any)
    jest
      .spyOn(runtimeSettingsRepository, 'getMany')
      .mockImplementation(async (keys: string[]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        keys.map((key) => (settings[key] ?? null) as any),
      )
    return get
  }

  // A healthy oracle reading, so a case about the balance is not silently
  // decided by the oracle conjunct behind it.
  const HEALTHY_ORACLE = setting({
    healthy: true,
    reason: null,
    servingStale: false,
    usdPerAi3: '6400000000000000',
    window: null,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    _resetThresholds()
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
    Object.assign(config.ethereum, ethereumDefaults)
    config.usdcPayments.enabledByDefault = enabledByDefault
  })

  // ──────────────────────────────────────────────────────────────────────────
  // getAvailability — the truth table
  // ──────────────────────────────────────────────────────────────────────────

  describe('getAvailability', () => {
    it('is open only when configured, manually enabled and within the cap', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting(
          { enabled: true },
          0,
          'admin-1',
        ),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: true,
      })
    })

    it('reports NOT_CONFIGURED without reading the database at all', async () => {
      config.ethereum.usdcReceiverAddress = undefined
      const getSpy = mockSettings({})

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.NOT_CONFIGURED,
      })
      // The cheapest gate first: a deployment that does not sell USDC should not
      // pay for a query on every page load.
      expect(getSpy).not.toHaveBeenCalled()
    })

    it('reports NOT_CONFIGURED on a half-configured deployment', async () => {
      // The receiver alone is not enough — the watcher refuses to build on a
      // partial configuration, and the quote side has to agree with it.
      config.ethereum.usdcTokenAddress = undefined
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.NOT_CONFIGURED,
      })
    })

    it('reports MANUAL_OFF when an admin has closed the switch', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting(
          { enabled: false },
          0,
          'admin-1',
        ),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.MANUAL_OFF,
      })
    })

    it('reports MANUAL_OFF before TREASURY_CAP when both are closed', async () => {
      // Precedence matters for what an operator does next: "I turned it off" and
      // "convert some USDC" are different actions, and the manual switch is the
      // one that will still be closed after the other is fixed.
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: false }),
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
        [RuntimeSettingKey.UsdcTreasury]: setting({
          balanceBaseUnits: '9999000000',
          paused: true,
          addresses: [],
        }),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.MANUAL_OFF,
      })
    })

    it('reports TREASURY_CAP when the poller has paused the gate', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
        [RuntimeSettingKey.UsdcTreasury]: setting({
          balanceBaseUnits: '2014000000',
          paused: true,
          addresses: [],
        }),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.TREASURY_CAP,
      })
    })

    it('fails closed with BALANCE_UNKNOWN when nothing has ever polled', async () => {
      // Cold start, or a payment worker that was never deployed. Distinguished
      // from "0 USDC held" deliberately: the dashboard must not claim an
      // observation it does not have.
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcTreasury]: null,
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.BALANCE_UNKNOWN,
      })
    })

    it('fails closed when the last reading is older than the stale window', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
        [RuntimeSettingKey.UsdcTreasury]: setting(
          { balanceBaseUnits: '1', paused: false, addresses: [] },
          config.usdcPayments.balanceMaxStaleMs + 1,
        ),
      })

      // An open gate read from a reading nobody has refreshed is not evidence:
      // the balance may have crossed the cap an hour ago. An Ethereum outage
      // must not become a way to keep selling.
      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.BALANCE_UNKNOWN,
      })
    })

    it('accepts a reading exactly on the stale boundary', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
        [RuntimeSettingKey.UsdcTreasury]: setting(
          { balanceBaseUnits: '1', paused: false, addresses: [] },
          config.usdcPayments.balanceMaxStaleMs,
        ),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: true,
      })
    })

    it('reports BALANCE_UNKNOWN before TREASURY_CAP for a stale paused reading', async () => {
      // Both would refuse, but only one of them is actionable by converting
      // USDC. The other means the worker cannot reach Ethereum.
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
        [RuntimeSettingKey.UsdcTreasury]: setting(
          { balanceBaseUnits: '9999000000', paused: true, addresses: [] },
          config.usdcPayments.balanceMaxStaleMs * 2,
        ),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.BALANCE_UNKNOWN,
      })
    })

    it('treats a non-boolean stored flag as off', async () => {
      // The value is JSON out of a database. Anything other than a literal true
      // on a payment gate reads as off.
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({
          enabled: 'yes',
        } as unknown as { enabled: boolean }),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.MANUAL_OFF,
      })
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // The manual gate's default, and what supersedes it
  // ──────────────────────────────────────────────────────────────────────────

  describe('getManualGate', () => {
    it('falls back to the environment default when no row exists', async () => {
      config.usdcPayments.enabledByDefault = true
      mockSettings({ [RuntimeSettingKey.UsdcManualGate]: null })

      const gate = await UsdcPaymentsUseCases.getManualGate()
      expect(gate.enabled).toBe(true)
      expect(gate.source).toBe(UsdcManualGateSource.ENV_DEFAULT)
      expect(gate.updatedBy).toBeNull()
      expect(gate.updatedAt).toBeNull()
    })

    it('lets a stored row win over the environment default', async () => {
      // The env var is a BOOT default and nothing more. Reporting the source is
      // what stops an operator from changing it in production and waiting for
      // something to happen.
      config.usdcPayments.enabledByDefault = true
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting(
          { enabled: false },
          1000,
          'admin-9',
        ),
      })

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
      const setSpy = jest.spyOn(runtimeSettingsRepository, 'set')

      const result = await UsdcPaymentsUseCases.setManualGate(plainUser, false)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
      expect(setSpy).not.toHaveBeenCalled()
    })

    it('attributes the write to the admin who made it', async () => {
      const setSpy = jest
        .spyOn(runtimeSettingsRepository, 'set')
        .mockResolvedValue(null)

      await UsdcPaymentsUseCases.setManualGate(admin, true)

      expect(setSpy).toHaveBeenCalledWith(
        RuntimeSettingKey.UsdcManualGate,
        { enabled: true },
        'admin-1',
      )
    })

    it('alerts on a real transition', async () => {
      jest
        .spyOn(runtimeSettingsRepository, 'set')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValue(setting({ enabled: true }, 0, 'admin-2') as any)
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
        .spyOn(runtimeSettingsRepository, 'set')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValue(setting({ enabled: false }, 0, 'admin-2') as any)
      const slackSpy = jest.spyOn(slackNotifier, 'send')

      const result = await UsdcPaymentsUseCases.setManualGate(admin, false)

      expect(result._unsafeUnwrap()).toEqual({ changed: false })
      expect(slackSpy).not.toHaveBeenCalled()
    })

    it('compares the first write against the environment default', async () => {
      // No row yet, and the env default already said "on": writing "on" is not a
      // change, and should not announce itself as one.
      config.usdcPayments.enabledByDefault = true
      jest.spyOn(runtimeSettingsRepository, 'set').mockResolvedValue(null)
      const slackSpy = jest.spyOn(slackNotifier, 'send')

      const result = await UsdcPaymentsUseCases.setManualGate(admin, true)

      expect(result._unsafeUnwrap()).toEqual({ changed: false })
      expect(slackSpy).not.toHaveBeenCalled()
    })

    it('treats the first write against a false default as a change', async () => {
      config.usdcPayments.enabledByDefault = false
      jest.spyOn(runtimeSettingsRepository, 'set').mockResolvedValue(null)
      const slackSpy = jest.spyOn(slackNotifier, 'send')

      const result = await UsdcPaymentsUseCases.setManualGate(admin, true)

      expect(result._unsafeUnwrap()).toEqual({ changed: true })
      expect(slackSpy).toHaveBeenCalledTimes(1)
      expect(slackSpy.mock.calls[0][0].title).toContain('ENABLED')
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

    it('reports the balance, the headroom and the audit trail', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting(
          { enabled: true },
          60_000,
          'admin-7',
        ),
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
        [RuntimeSettingKey.UsdcTreasury]: setting(
          {
            balanceBaseUnits: '1500000000',
            paused: false,
            addresses: ['0x1111111111111111111111111111111111111111'],
          },
          30_000,
        ),
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
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
        [RuntimeSettingKey.UsdcTreasury]: setting({
          balanceBaseUnits: '2014000000',
          paused: true,
          addresses: [],
        }),
      })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()
      // How far over, which is the conversion size.
      expect(status.treasury.headroomBaseUnits).toBe('-14000000')
    })

    it('says paused-and-stale rather than paused, when nothing has polled', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcTreasury]: null,
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
      })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.treasury.paused).toBe(true)
      // The pair is what stops the dashboard from printing "auto-paused: 0.00
      // USDC held" — a sentence an operator would rightly disbelieve.
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
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
        [RuntimeSettingKey.UsdcOracle]: setting({
          healthy: false,
          reason: 'thin-liquidity',
          servingStale: false,
          usdPerAi3: null,
          window: null,
        }),
      })

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
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
      })
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
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
        [RuntimeSettingKey.UsdcOracle]: null,
      })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.oracle.stale).toBe(true)
      expect(status.oracle.healthy).toBe(false)
      expect(status.oracle.reason).toBeNull()
      expect(status.availability).toEqual({
        open: false,
        closedReason: UsdcClosedReason.ORACLE_UNAVAILABLE,
      })
    })

    it('renders rather than 500s when the address configuration is unusable', async () => {
      // The page an operator opens to find out why the path is shut must not be
      // the page that breaks on the reason.
      config.usdcPayments.treasuryAddresses = ['not-an-address']
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcTreasury]: null,
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
      })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.treasury.addressError).toContain('USDC_TREASURY_ADDRESSES')
      expect(status.treasury.addresses).toEqual([])
      config.usdcPayments.treasuryAddresses = []
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Thresholds
  // ──────────────────────────────────────────────────────────────────────────

  describe('getThresholds', () => {
    const usdcDefaults = { ...config.usdcPayments }

    afterEach(() => {
      Object.assign(config.usdcPayments, usdcDefaults)
      _resetThresholds()
    })

    it('treats an EMPTY resume threshold as unset, not as a parse error', async () => {
      // The failure this pins: `.env.sample` ships USDC_TREASURY_RESUME_THRESHOLD
      // with an empty value, and dotenv parses `KEY=` to '' — which is not
      // undefined. Parsed, that empty string fails, the gates job refuses to
      // start, and USDC stays permanently closed on any deployment that
      // configured itself the documented way. Config normalises it to undefined;
      // this asserts the behaviour that depends on it.
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

    it('renders the status page rather than 500ing on an unparseable cap', async () => {
      // A malformed threshold already stops the poller, so the path is shut —
      // and this is the page an operator opens to find out why. It must not be
      // the page that breaks, or the kill switch goes off the screen with it.
      config.usdcPayments.pauseThresholdUsdc = '2,000'
      _resetThresholds()
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }, 0, 'a-1'),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
      })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.treasury.thresholdError).toContain(
        'USDC_TREASURY_PAUSE_THRESHOLD',
      )
      expect(status.treasury.pauseThresholdBaseUnits).toBeNull()
      expect(status.treasury.headroomBaseUnits).toBeNull()
      // The switch and its audit trail still render — that is the point.
      expect(status.manualGate.enabled).toBe(true)
      expect(status.manualGate.updatedBy).toBe('a-1')
    })

    it('describes a capped treasury without the figure when the cap is unreadable', () => {
      // This sentence reaches a user, inside a 503. An unparseable cap must not
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
  // Unreadable rows: the direction of the failure is the point
  // ──────────────────────────────────────────────────────────────────────────

  describe('malformed snapshots', () => {
    it('fails CLOSED on a treasury row with no `paused` field', async () => {
      // A truthiness test on untyped jsonb would read this as "not paused" and
      // OPEN the money gate — the one direction this module must never go. Rows
      // are hand-editable during an incident and their shape changes across
      // releases.
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
        [RuntimeSettingKey.UsdcTreasury]: setting({
          balanceBaseUnits: '1000000',
        } as never),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.BALANCE_UNKNOWN,
      })
    })

    it('fails closed on a non-numeric balance', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
        [RuntimeSettingKey.UsdcTreasury]: setting({
          balanceBaseUnits: 'lots',
          paused: false,
          addresses: [],
        } as never),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.BALANCE_UNKNOWN,
      })
    })

    it('does not 500 the status endpoint on a malformed balance', async () => {
      // The same bad row used to reach BigInt() and take the diagnostic page
      // down with it.
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcOracle]: HEALTHY_ORACLE,
        [RuntimeSettingKey.UsdcTreasury]: setting({
          balanceBaseUnits: 'lots',
          paused: false,
          addresses: [],
        } as never),
      })

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()
      expect(status.treasury.balanceBaseUnits).toBeNull()
      expect(status.treasury.paused).toBe(true)
      expect(status.treasury.stale).toBe(true)
    })

    it('fails closed on an unreadable oracle row', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
        [RuntimeSettingKey.UsdcOracle]: setting({ rate: 'fine' } as never),
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.ORACLE_UNAVAILABLE,
      })
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // treasuryAddresses
  // ──────────────────────────────────────────────────────────────────────────

  describe('treasuryAddresses', () => {
    const configuredDefaults = [...config.usdcPayments.treasuryAddresses]

    afterEach(() => {
      config.usdcPayments.treasuryAddresses = [...configuredDefaults]
    })

    it('watches the receiver when nothing else is configured', () => {
      config.usdcPayments.treasuryAddresses = []
      expect(UsdcPaymentsUseCases.treasuryAddresses()).toEqual([
        '0x1111111111111111111111111111111111111111',
      ])
    })

    it('always includes the receiver, even when a list is configured', () => {
      // The failure this prevents: reading the variable the obvious way and
      // setting it to the sweep destination alone would stop counting the
      // address payments actually land in, so the cap would never bind.
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
      // Summing an empty list to zero would report an empty treasury and hold
      // the gate open on no evidence at all, so the poller refuses instead.
      expect(UsdcPaymentsUseCases.treasuryAddresses()).toEqual([])
    })
  })
})
