import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { ok, err } from 'neverthrow'
import {
  decidePaused,
  usdcGatesJob,
} from '../../src/infrastructure/services/usdcGatesJob.js'
import {
  UsdcPaymentsUseCases,
  _resetThresholds,
} from '../../src/core/payments/usdc.js'
import { usdcPaymentStateRepository } from '../../src/infrastructure/repositories/usdcPaymentState.js'
import { slackNotifier } from '../../src/infrastructure/services/slack/index.js'
import { priceOracle } from '../../src/infrastructure/services/priceOracle/index.js'
import { OracleUnavailableError } from '../../src/infrastructure/services/priceOracle/types.js'
import { config } from '../../src/config.js'

const USDC = 1_000_000n
const RECEIVER = '0x1111111111111111111111111111111111111111'
const SECOND_ADDRESS = '0x2222222222222222222222222222222222222222'
const USDC_TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

// ────────────────────────────────────────────────────────────────────────────
// The hysteresis rule, on its own.
//
// Thresholds are passed explicitly: the shipped default has resume = pause, so
// the band is empty — and the band is the part worth testing.
// ────────────────────────────────────────────────────────────────────────────

describe('decidePaused', () => {
  const PAUSE = 2000n * USDC
  const RESUME = 1500n * USDC

  it('pauses at the cap exactly', () => {
    // "At or above", not "above": the cap is the figure that must never be
    // exceeded, so reaching it closes the gate.
    expect(decidePaused(PAUSE, false, PAUSE, RESUME)).toBe(true)
  })

  it('pauses above the cap', () => {
    expect(decidePaused(PAUSE + 1n, false, PAUSE, RESUME)).toBe(true)
  })

  it('resumes below the resume threshold', () => {
    expect(decidePaused(RESUME - 1n, true, PAUSE, RESUME)).toBe(false)
  })

  it('keeps a paused gate paused inside the band', () => {
    // The whole point of two thresholds: inside the band nothing changes, so a
    // balance sitting on a line cannot flap the gate — and the alerts — on every
    // poll.
    expect(decidePaused(RESUME, true, PAUSE, RESUME)).toBe(true)
    expect(decidePaused(PAUSE - 1n, true, PAUSE, RESUME)).toBe(true)
  })

  it('keeps an open gate open inside the band', () => {
    expect(decidePaused(RESUME, false, PAUSE, RESUME)).toBe(false)
    expect(decidePaused(PAUSE - 1n, false, PAUSE, RESUME)).toBe(false)
  })

  it('judges the band against the cap alone with no previous state', () => {
    // No row at all, so there is no transition to damp and the band does not
    // apply: the balance is under the cap, so the gate is open. Failing closed
    // here reads as the safer choice but is not, because runCheck PERSISTS the
    // answer — see the two-poll test below.
    expect(decidePaused(RESUME, null, PAUSE, RESUME)).toBe(false)
    expect(decidePaused(PAUSE - 1n, null, PAUSE, RESUME)).toBe(false)
  })

  it('needs no previous state outside the band', () => {
    expect(decidePaused(RESUME - 1n, null, PAUSE, RESUME)).toBe(false)
    expect(decidePaused(PAUSE, null, PAUSE, RESUME)).toBe(true)
  })

  it('leaves no dead zone when the thresholds are equal (the default)', () => {
    expect(decidePaused(PAUSE - 1n, null, PAUSE, PAUSE)).toBe(false)
    expect(decidePaused(PAUSE, null, PAUSE, PAUSE)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// The poll itself, with the chain read and the rate read replaced through the
// job's `_internal` indirection (the same seam the price oracle exposes).
// ────────────────────────────────────────────────────────────────────────────

describe('USDC gates job', () => {
  const ethereumDefaults = { ...config.ethereum }
  const usdcDefaults = { ...config.usdcPayments }

  // Balances are served in the order the addresses are polled; an Error stands
  // in for every way Ethereum can be unreachable — a rate limit, a dead
  // endpoint, a timeout.
  const mockBalances = (balances: bigint[] | Error) => {
    const remaining = Array.isArray(balances) ? [...balances] : []
    return jest
      .spyOn(usdcGatesJob._internal, 'readBalance')
      .mockImplementation(async () => {
        if (!Array.isArray(balances)) {
          throw balances
        }
        return remaining.shift() ?? 0n
      })
  }

  const mockRate = (healthy: boolean, reason = 'thin-liquidity') =>
    jest
      .spyOn(usdcGatesJob._internal, 'readRate')
      .mockResolvedValue(
        healthy
          ? ok({
              usdPerAi3: 6_400_000_000_000_000n,
              asOf: new Date('2026-08-24T00:00:00Z'),
              fromCache: false,
              stale: false,
            })
          : err(
              new OracleUnavailableError(
                'pool is empty',
                reason as 'thin-liquidity',
              ),
            ),
      )

  // What the poller finds already stored. The age is the fact that decides
  // whether it counts as previous state for ALERTING — a stale reading still
  // breaks a hysteresis tie, but nobody could have seen the gate meanwhile.
  const STALE_MS = 3_600_000

  let previousTreasury: {
    balanceBaseUnits: bigint
    paused: boolean
    addresses: string[]
    checkedAt: Date
    ageMs: number
  } | null = null
  let previousOracle: {
    healthy: boolean
    reason: string | null
    servingStale: boolean
    usdPerAi3: bigint | null
    window: null
    checkedAt: Date
    ageMs: number
  } | null = null

  const applyReadings = () =>
    jest
      .spyOn(usdcPaymentStateRepository, 'getReadings')
      .mockResolvedValue({ treasury: previousTreasury, oracle: previousOracle })

  const mockPreviousTreasury = (
    reading: { balanceBaseUnits: string; paused: boolean } | null,
    stale = false,
  ) => {
    const ageMs = stale ? STALE_MS : 60_000
    previousTreasury = reading
      ? {
          balanceBaseUnits: BigInt(reading.balanceBaseUnits),
          paused: reading.paused,
          addresses: [RECEIVER],
          checkedAt: new Date(Date.now() - ageMs),
          ageMs,
        }
      : null
    return applyReadings()
  }

  const mockPreviousOracle = (healthy: boolean | null, stale = false) => {
    const ageMs = stale ? STALE_MS : 0
    previousOracle =
      healthy === null
        ? null
        : {
            healthy,
            reason: healthy ? null : 'thin-liquidity',
            servingStale: false,
            usdPerAi3: healthy ? 6_400_000_000_000_000n : null,
            window: null,
            checkedAt: new Date(Date.now() - ageMs),
            ageMs,
          }
    return applyReadings()
  }

  const mockManualGate = (enabled: boolean) =>
    jest.spyOn(UsdcPaymentsUseCases, 'getManualGate').mockResolvedValue({
      enabled,
      source: 'admin' as never,
      updatedBy: 'admin-1',
      updatedAt: new Date(),
    })

  const watching = (addresses: string[]) =>
    jest
      .spyOn(UsdcPaymentsUseCases, 'treasuryAddresses')
      .mockReturnValue(addresses)

  let slackSpy: jest.SpiedFunction<typeof slackNotifier.send>
  let setSpy: jest.SpiedFunction<
    typeof usdcPaymentStateRepository.saveTreasuryReading
  >
  let oracleWriteSpy: jest.SpiedFunction<
    typeof usdcPaymentStateRepository.saveOracleReading
  >

  beforeEach(() => {
    jest.clearAllMocks()
    config.ethereum.rpcUrl = 'http://example.org'
    config.ethereum.usdcReceiverAddress = RECEIVER
    config.ethereum.usdcTokenAddress = USDC_TOKEN
    _resetThresholds()
    usdcGatesJob._resetAlertState()
    slackSpy = jest.spyOn(slackNotifier, 'send').mockResolvedValue(true)
    previousTreasury = null
    previousOracle = null
    applyReadings()
    setSpy = jest
      .spyOn(usdcPaymentStateRepository, 'saveTreasuryReading')
      .mockResolvedValue()
    oracleWriteSpy = jest
      .spyOn(usdcPaymentStateRepository, 'saveOracleReading')
      .mockResolvedValue()
    jest.spyOn(usdcGatesJob._internal, 'sendMetric').mockResolvedValue()
    // The oracle half is exercised in its own block; keep it out of the way and
    // closed by default so a balance case cannot depend on it.
    mockManualGate(false)
    mockPreviousOracle(null)
    jest.spyOn(priceOracle, 'getHealth').mockReturnValue({
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      window: null,
      servingStale: false,
    })
  })

  afterEach(() => {
    usdcGatesJob.stop()
    jest.restoreAllMocks()
    Object.assign(config.ethereum, ethereumDefaults)
    Object.assign(config.usdcPayments, usdcDefaults)
    _resetThresholds()
  })

  // ── the balance gate ──────────────────────────────────────────────────────

  it('sums every watched address and writes the derived gate', async () => {
    mockBalances([100n * USDC, 50n * USDC])
    watching([RECEIVER, SECOND_ADDRESS])
    mockPreviousTreasury(null)

    await usdcGatesJob._runCheck()

    expect(setSpy).toHaveBeenCalledWith({
      balanceBaseUnits: 150n * USDC,
      paused: false,
      // Recorded with the reading: "paused at 2,014" means something else if it
      // was counting two addresses.
      addresses: [RECEIVER, SECOND_ADDRESS],
    })
  })

  it('pauses at the cap and alerts once, not on every poll', async () => {
    mockBalances([2000n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury({ balanceBaseUnits: '0', paused: false })

    await usdcGatesJob._runCheck()

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paused: true }),
    )
    expect(slackSpy).toHaveBeenCalledTimes(1)
    expect(slackSpy.mock.calls[0][0].title).toContain('auto-paused')

    // The same state again, and — the point of judging transitions against the
    // STORED value — this holds across a restart too, because the comparison is
    // not in memory. 288 polls a day that each alert is how the channel that
    // reports a shut payment path gets muted.
    mockBalances([2000n * USDC])
    mockPreviousTreasury({
      balanceBaseUnits: (2000n * USDC).toString(),
      paused: true,
    })
    await usdcGatesJob._runCheck()

    expect(slackSpy).toHaveBeenCalledTimes(1)
  })

  it('alerts on the way back down', async () => {
    mockBalances([10n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury({
      balanceBaseUnits: (2000n * USDC).toString(),
      paused: true,
    })

    await usdcGatesJob._runCheck()

    expect(slackSpy).toHaveBeenCalledTimes(1)
    expect(slackSpy.mock.calls[0][0].title).toContain('auto-resumed')
  })

  it('says nothing on a first poll that finds everything fine', async () => {
    // Starting up is not an event. A deployment that comes up healthy should not
    // post to Slack for it.
    mockBalances([10n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)

    await usdcGatesJob._runCheck()

    expect(slackSpy).not.toHaveBeenCalled()
  })

  it('says so on a first poll that finds the cap already exceeded', async () => {
    mockBalances([3000n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)

    await usdcGatesJob._runCheck()

    expect(slackSpy).toHaveBeenCalledTimes(1)
    expect(slackSpy.mock.calls[0][0].title).toContain('auto-paused')
  })

  it('re-states a pause after an outage, since nobody could see it meanwhile', async () => {
    // A stale row is previous state for HYSTERESIS but not for alerting: after
    // a gap nobody knows what the gate was doing, so saying it again is the
    // honest report rather than a duplicate.
    mockBalances([3000n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(
      { balanceBaseUnits: (3000n * USDC).toString(), paused: true },
      true,
    )

    await usdcGatesJob._runCheck()

    expect(slackSpy).toHaveBeenCalledTimes(1)
    expect(slackSpy.mock.calls[0][0].title).toContain('auto-paused')
  })

  // ── hysteresis end to end, with the thresholds actually split ─────────────

  it('keeps a mid-band balance open across a restart, rather than latching shut', async () => {
    // The failure this prevents: on a restart with no FRESH previous reading, a
    // mid-band balance used to fail closed and then stay closed forever, because
    // every later poll saw its own fresh `paused: true` inside the band. USDC
    // sales would stop after any deploy that happened with a mid-band balance,
    // and the alert would say "cap reached" for a balance under the cap.
    config.usdcPayments.pauseThresholdUsdc = '2000'
    config.usdcPayments.resumeThresholdUsdc = '1500'
    _resetThresholds()

    mockBalances([1600n * USDC])
    watching([RECEIVER])
    // Stale — the worker has just restarted — but it recorded an open gate.
    mockPreviousTreasury({ balanceBaseUnits: '1600000000', paused: false }, true)

    await usdcGatesJob._runCheck()

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paused: false }),
    )
  })

  it('holds a mid-band balance closed when the previous gate was closed', async () => {
    config.usdcPayments.pauseThresholdUsdc = '2000'
    config.usdcPayments.resumeThresholdUsdc = '1500'
    _resetThresholds()

    mockBalances([1600n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury({ balanceBaseUnits: '2100000000', paused: true })

    await usdcGatesJob._runCheck()

    // Still paused: a conversion has to bring the balance under the resume line,
    // which is what stops the gate flapping around the cap.
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paused: true }),
    )
    expect(slackSpy).not.toHaveBeenCalled()
  })

  it('does not latch a mid-band balance shut when there is no previous row', async () => {
    // The unrecoverable state this replaces: with no row, a mid-band balance
    // failed closed, that guess was WRITTEN, and the next poll read it back as
    // an observation the band then preserved. Three polls in a row and the gate
    // was shut for good, with an alert naming a cap the balance was under.
    //
    // Reachable rather than theoretical: this feature's down migration drops
    // usdc_gate_readings, so a rollback and re-apply mid-band lands here.
    config.usdcPayments.pauseThresholdUsdc = '2000'
    config.usdcPayments.resumeThresholdUsdc = '1500'
    _resetThresholds()

    mockBalances([1600n * USDC, 1600n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)

    await usdcGatesJob._runCheck()

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paused: false }),
    )

    // Feed the first poll's own write back in, which is what the repository
    // does. Under the old rule this is where the guess became permanent.
    const written = setSpy.mock.calls[0][0] as { paused: boolean }
    mockPreviousTreasury({
      balanceBaseUnits: '1600000000',
      paused: written.paused,
    })

    await usdcGatesJob._runCheck()

    expect(setSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ paused: false }),
    )
    // And no alert claiming a cap that a 1,600 balance has not reached.
    expect(slackSpy).not.toHaveBeenCalled()
  })

  // ── failure handling ──────────────────────────────────────────────────────

  it('writes nothing when the chain read fails', async () => {
    mockBalances(new Error('rpc down'))
    watching([RECEIVER])
    mockPreviousTreasury({ balanceBaseUnits: '0', paused: false }, true)

    await usdcGatesJob._runCheck()

    // The row's AGE is the outage signal. A write on failure would refresh
    // updated_at, and "balance unknown" — the fail-closed state — would be
    // unreachable.
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('alerts once when the failure has outlived the stale window', async () => {
    mockBalances(new Error('rpc down'))
    watching([RECEIVER])
    mockPreviousTreasury({ balanceBaseUnits: '0', paused: false }, true)

    await usdcGatesJob._runCheck()
    // Still down on the next poll: one alert, not one every five minutes.
    await usdcGatesJob._runCheck()

    expect(slackSpy).toHaveBeenCalledTimes(1)
    expect(slackSpy.mock.calls[0][0].title).toContain('unknown')
  })

  it('retries the unknown-balance alert when the webhook rejected it', async () => {
    // slackNotifier.send returns false rather than throwing on a rate limit or a
    // bad webhook. Latching the memo regardless would lose the alert for good
    // while the condition persisted.
    slackSpy.mockResolvedValue(false)
    mockBalances(new Error('rpc down'))
    watching([RECEIVER])
    mockPreviousTreasury({ balanceBaseUnits: '0', paused: false }, true)

    await usdcGatesJob._runCheck()
    await usdcGatesJob._runCheck()

    expect(slackSpy).toHaveBeenCalledTimes(2)
  })

  it('stays quiet on a single failed poll inside the stale window', async () => {
    mockBalances(new Error('rate limited'))
    watching([RECEIVER])
    // A recent good reading still stands, so the gate keeps its value and nobody
    // needs waking for one dropped poll.
    mockPreviousTreasury({ balanceBaseUnits: '0', paused: false }, false)

    await usdcGatesJob._runCheck()

    expect(setSpy).not.toHaveBeenCalled()
    expect(slackSpy).not.toHaveBeenCalled()
  })

  it('leaves the gate closed when the address configuration is unusable', async () => {
    // Dropping the bad entry would count its balance as zero and let the
    // treasury exceed its cap, so the poll refuses instead and the row ages into
    // BALANCE_UNKNOWN.
    const readSpy = mockBalances([1n * USDC])
    jest
      .spyOn(UsdcPaymentsUseCases, 'treasuryAddresses')
      .mockImplementation(() => {
        throw new Error('Invalid address in USDC_TREASURY_ADDRESSES: "nope"')
      })

    await usdcGatesJob._runCheck()

    expect(readSpy).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('writes nothing when no address can be resolved', async () => {
    const readSpy = mockBalances([1n * USDC])
    watching([])

    await usdcGatesJob._runCheck()

    // Summing an empty list to zero would report an empty treasury and hold the
    // gate open on no evidence at all.
    expect(setSpy).not.toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('reads the balance of every watched address', async () => {
    const readSpy = mockBalances([1n * USDC, 2n * USDC])
    watching([RECEIVER, SECOND_ADDRESS])
    mockPreviousTreasury(null)

    await usdcGatesJob._runCheck()

    expect(readSpy.mock.calls.map((call) => call[0])).toEqual([
      RECEIVER,
      SECOND_ADDRESS,
    ])
  })

  it('cannot touch the manual switch', async () => {
    // The latching invariant. It is now structural — the switch is a different
    // table and this module never imports a writer for it — so this asserts the
    // shape of the collaboration rather than a value: the only writes a poll
    // makes are readings.
    mockBalances([1n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)
    const switchSpy = jest.spyOn(usdcPaymentStateRepository, 'setSwitch')

    await usdcGatesJob._runCheck()

    expect(switchSpy).not.toHaveBeenCalled()
    expect(setSpy).toHaveBeenCalledTimes(1)
  })

  // ── metrics ───────────────────────────────────────────────────────────────

  it('publishes the balance as a gauge, including on a failed poll', async () => {
    // The alerts can only fire once the cap has ALREADY been reached; a gauge is
    // how a manual conversion workflow sees it coming, and a series going flat is
    // the only way to notice a dead worker.
    mockBalances([1500n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)
    const metricSpy = jest.spyOn(usdcGatesJob._internal, 'sendMetric')

    await usdcGatesJob._runCheck()

    expect(metricSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        measurement: 'usdc_treasury',
        fields: expect.objectContaining({
          balance_base_units: 1500n * USDC,
          paused: 0,
          stale: 0,
        }),
      }),
    )

    metricSpy.mockClear()
    mockBalances(new Error('rpc down'))
    mockPreviousTreasury({ balanceBaseUnits: '0', paused: false }, true)
    await usdcGatesJob._runCheck()

    expect(metricSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({ stale: 1, paused: 1 }),
      }),
    )

    // The amounts are absent rather than zero. Publishing 0 headroom during an
    // RPC outage would fire a headroom alert saying the treasury is at its cap,
    // which is the opposite of what happened — and docs/payments.md points
    // operators at this exact series.
    const failed = metricSpy.mock.calls[0][0].fields
    expect(failed).not.toHaveProperty('balance_base_units')
    expect(failed).not.toHaveProperty('headroom_base_units')
    // The fields that are still knowable keep reporting.
    expect(failed).toHaveProperty('cap_base_units')
  })

  // ── the oracle gate ───────────────────────────────────────────────────────

  it('does not read the rate while the manual gate is closed', async () => {
    // MANUAL_OFF is reported first, so the rate would change no decision — and
    // every read is a billed subgraph query.
    mockBalances([1n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)
    mockManualGate(false)
    const rateSpy = mockRate(true)

    await usdcGatesJob._runCheck()

    expect(rateSpy).not.toHaveBeenCalled()
  })

  it('records a healthy rate when the manual gate is open', async () => {
    mockBalances([1n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)
    mockManualGate(true)
    mockRate(true)
    mockPreviousOracle(null)

    await usdcGatesJob._runCheck()

    expect(oracleWriteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        healthy: true,
        reason: null,
        usdPerAi3: 6_400_000_000_000_000n,
      }),
    )
  })

  it('records a refusal with the guard that fired', async () => {
    // A refusal IS the observation here, unlike a failed balance read: the
    // oracle failing closed is exactly what this gate needs to know, so it is
    // written rather than left to age.
    mockBalances([1n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)
    mockManualGate(true)
    mockRate(false, 'thin-liquidity')
    mockPreviousOracle(true)

    await usdcGatesJob._runCheck()

    expect(oracleWriteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ healthy: false, reason: 'thin-liquidity' }),
    )
    expect(
      slackSpy.mock.calls.some((call) =>
        call[0].title.includes('oracle unavailable'),
      ),
    ).toBe(true)
  })

  it('does not alert per poll while the oracle stays unhealthy', async () => {
    // The normal state of a pool with no liquidity. Alerting per poll would post
    // ~288 times a day.
    mockBalances([1n * USDC, 1n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)
    mockManualGate(true)
    mockRate(false)
    mockPreviousOracle(false)

    await usdcGatesJob._runCheck()

    expect(
      slackSpy.mock.calls.some((call) => call[0].title.includes('oracle')),
    ).toBe(false)
  })

  it('stays quiet on a first oracle reading that is healthy', async () => {
    mockBalances([1n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)
    mockManualGate(true)
    mockRate(true)
    mockPreviousOracle(null)

    await usdcGatesJob._runCheck()

    expect(
      slackSpy.mock.calls.some((call) => call[0].title.includes('oracle')),
    ).toBe(false)
  })

  it('alerts when the oracle recovers', async () => {
    mockBalances([1n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)
    mockManualGate(true)
    mockRate(true)
    mockPreviousOracle(false)

    await usdcGatesJob._runCheck()

    expect(
      slackSpy.mock.calls.some((call) => call[0].title.includes('recovered')),
    ).toBe(true)
  })

  // ── lifecycle ─────────────────────────────────────────────────────────────

  it('does not start without a USDC configuration', () => {
    config.ethereum.usdcReceiverAddress = undefined
    const stateSpy = jest.spyOn(usdcPaymentStateRepository, 'getReadings')

    usdcGatesJob.start()

    // A deployment that does not sell USDC has nothing to poll, and should not
    // hold an Ethereum endpoint open to find that out.
    expect(stateSpy).not.toHaveBeenCalled()
  })

  it('refuses to start on an unparseable threshold instead of throwing', async () => {
    // This process also runs uploads and credit expiry. A malformed payments
    // variable must leave the gate closed, not take those down — and the
    // import-time parse it replaces would have crash-looped the download API too.
    config.usdcPayments.pauseThresholdUsdc = '2,000'
    _resetThresholds()
    const readSpy = mockBalances([1n * USDC])
    watching([RECEIVER])

    expect(() => usdcGatesJob.start()).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))

    expect(readSpy).not.toHaveBeenCalled()
    expect(slackSpy.mock.calls[0][0].title).toContain('bad configuration')
  })

  it('polls immediately on start rather than after one interval', async () => {
    // The gates fail closed while their facts are unknown, so waiting five
    // minutes after every deploy would shut the purchase path for five minutes
    // after every deploy.
    const readSpy = mockBalances([1n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)

    usdcGatesJob.start()
    await new Promise((resolve) => setImmediate(resolve))

    expect(readSpy).toHaveBeenCalledTimes(1)
  })

  it('ignores a second start rather than doubling the poll', async () => {
    const readSpy = mockBalances([1n * USDC, 1n * USDC])
    watching([RECEIVER])
    mockPreviousTreasury(null)

    usdcGatesJob.start()
    usdcGatesJob.start()
    await new Promise((resolve) => setImmediate(resolve))

    // One poll, and — more to the point — one interval: a second one would be
    // unreachable by stop() and would keep polling, and alerting, for the life
    // of the process.
    expect(readSpy).toHaveBeenCalledTimes(1)
  })
})
