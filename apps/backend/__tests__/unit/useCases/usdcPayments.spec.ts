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
import { UsdcPaymentsUseCases } from '../../../src/core/payments/usdc.js'
import {
  RuntimeSettingKey,
  runtimeSettingsRepository,
  type RuntimeSetting,
} from '../../../src/infrastructure/repositories/runtimeSettings.js'
import { slackNotifier } from '../../../src/infrastructure/services/slack/index.js'
import { priceOracle } from '../../../src/infrastructure/services/priceOracle/index.js'
import { OracleUnavailableError } from '../../../src/infrastructure/services/priceOracle/types.js'
import { config } from '../../../src/config.js'
import { ForbiddenError } from '../../../src/errors/index.js'
import { err, ok } from 'neverthrow'

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
  // the other to be out of the way.
  const mockSettings = (
    settings: Partial<Record<string, RuntimeSetting<unknown> | null>>,
  ) =>
    jest
      .spyOn(runtimeSettingsRepository, 'get')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(async (key: string) => (settings[key] ?? null) as any)

  beforeEach(() => {
    jest.clearAllMocks()
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
      })

      expect(await UsdcPaymentsUseCases.getAvailability()).toEqual({
        open: false,
        closedReason: UsdcClosedReason.BALANCE_UNKNOWN,
      })
    })

    it('fails closed when the last reading is older than the stale window', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
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
    beforeEach(() => {
      jest.spyOn(priceOracle, 'getPrice').mockResolvedValue(
        ok({
          usdPerAi3: 6_400_000_000_000_000n,
          asOf: new Date('2026-08-24T00:00:00Z'),
          fromCache: false,
          stale: false,
        }),
      )
      jest.spyOn(priceOracle, 'getHealth').mockReturnValue({
        lastSuccessAt: new Date('2026-08-24T00:00:00Z'),
        lastFailureAt: null,
        lastFailureReason: null,
        window: null,
        servingStale: false,
      })
    })

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

    it('reports the oracle as unhealthy with the guard that fired', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
      })
      jest
        .spyOn(priceOracle, 'getPrice')
        .mockResolvedValue(
          err(new OracleUnavailableError('pool is empty', 'thin-liquidity')),
        )

      const status = (
        await UsdcPaymentsUseCases.getStatus(admin)
      )._unsafeUnwrap()

      expect(status.oracle.healthy).toBe(false)
      expect(status.oracle.currentFailureReason).toBe('thin-liquidity')
      // And the composite stays OPEN: the oracle is a quote-time veto, not an
      // availability gate. /features must not shut the path because one replica
      // could not read the subgraph.
      expect(status.availability).toEqual({ open: true })
    })

    it('forces a rate read so the health it reports was observed here', async () => {
      mockSettings({
        [RuntimeSettingKey.UsdcManualGate]: setting({ enabled: true }),
        [RuntimeSettingKey.UsdcTreasury]: FRESH_OPEN_TREASURY,
      })
      const priceSpy = jest.spyOn(priceOracle, 'getPrice')

      await UsdcPaymentsUseCases.getStatus(admin)

      // Health is per-process in-memory state: a replica that has never quoted
      // would otherwise report an empty record as though it were an observation.
      expect(priceSpy).toHaveBeenCalledTimes(1)
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

    it('defaults to the receiver', () => {
      config.usdcPayments.treasuryAddresses = []
      expect(UsdcPaymentsUseCases.treasuryAddresses()).toEqual([
        '0x1111111111111111111111111111111111111111',
      ])
    })

    it('checksums and de-duplicates the configured list', () => {
      // The same account written two ways must not have its balance counted
      // twice against the cap.
      config.usdcPayments.treasuryAddresses = [
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      ]
      expect(UsdcPaymentsUseCases.treasuryAddresses()).toEqual([
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      ])
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
