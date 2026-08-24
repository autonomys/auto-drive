import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import {
  decidePaused,
  usdcTreasuryBalanceJob,
} from '../../src/infrastructure/services/usdcTreasuryBalanceJob.js'
import {
  UsdcPaymentsUseCases,
  pauseThresholdBaseUnits,
} from '../../src/core/payments/usdc.js'
import {
  RuntimeSettingKey,
  runtimeSettingsRepository,
} from '../../src/infrastructure/repositories/runtimeSettings.js'
import { slackNotifier } from '../../src/infrastructure/services/slack/index.js'
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

  it('fails closed inside the band with no previous state', () => {
    // A first poll, or one following a reading too old to trust. "No evidence
    // the cap was respected" is not "the cap is respected", and being wrong this
    // way costs an unquoted purchase rather than un-hedged USDC.
    expect(decidePaused(RESUME, null, PAUSE, RESUME)).toBe(true)
    expect(decidePaused(PAUSE - 1n, null, PAUSE, RESUME)).toBe(true)
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
// The poll itself, with the chain read replaced through the job's `_internal`
// indirection (the same seam the price oracle exposes for its subgraph query).
// ────────────────────────────────────────────────────────────────────────────

describe('USDC treasury balance job', () => {
  const ethereumDefaults = { ...config.ethereum }

  // Balances are served in the order the addresses are polled; an Error stands
  // in for every way Ethereum can be unreachable — a rate limit, a dead
  // endpoint, a timeout.
  const mockBalances = (balances: bigint[] | Error) => {
    const remaining = Array.isArray(balances) ? [...balances] : []
    return jest
      .spyOn(usdcTreasuryBalanceJob._internal, 'readBalance')
      .mockImplementation(async () => {
        if (!Array.isArray(balances)) {
          throw balances
        }
        return remaining.shift() ?? 0n
      })
  }

  // What the poller finds already stored. `stale` is the fact that decides
  // whether it counts as previous state at all.
  const mockPrevious = (
    snapshot: { balanceBaseUnits: string; paused: boolean } | null,
    stale = false,
  ) =>
    jest.spyOn(UsdcPaymentsUseCases, 'getTreasuryState').mockResolvedValue({
      snapshot: snapshot ? { ...snapshot, addresses: [RECEIVER] } : null,
      stale,
      checkedAt: snapshot ? new Date(Date.now() - 60_000) : null,
      ageMs: snapshot ? 60_000 : null,
    })

  const watching = (addresses: string[]) =>
    jest
      .spyOn(UsdcPaymentsUseCases, 'treasuryAddresses')
      .mockReturnValue(addresses)

  let slackSpy: jest.SpiedFunction<typeof slackNotifier.send>
  let setSpy: jest.SpiedFunction<typeof runtimeSettingsRepository.set>

  beforeEach(() => {
    jest.clearAllMocks()
    config.ethereum.rpcUrl = 'http://example.org'
    config.ethereum.usdcReceiverAddress = RECEIVER
    config.ethereum.usdcTokenAddress = USDC_TOKEN
    // The alerting memo is module state; a case that asserts "alerts once" has
    // to start from a known point.
    usdcTreasuryBalanceJob._resetReportedState()
    slackSpy = jest.spyOn(slackNotifier, 'send').mockResolvedValue(true)
    setSpy = jest
      .spyOn(runtimeSettingsRepository, 'set')
      .mockResolvedValue(null)
  })

  afterEach(() => {
    usdcTreasuryBalanceJob.stop()
    jest.restoreAllMocks()
    Object.assign(config.ethereum, ethereumDefaults)
  })

  it('sums every watched address and writes the derived gate', async () => {
    mockBalances([100n * USDC, 50n * USDC])
    watching([RECEIVER, SECOND_ADDRESS])
    mockPrevious(null)

    await usdcTreasuryBalanceJob._runCheck()

    expect(setSpy).toHaveBeenCalledWith(
      RuntimeSettingKey.UsdcTreasury,
      {
        balanceBaseUnits: (150n * USDC).toString(),
        paused: false,
        // Recorded with the reading: "paused at 2,014" means something else if
        // it was counting two addresses.
        addresses: [RECEIVER, SECOND_ADDRESS],
      },
      // No admin behind this write. The null IS the audit record — and the
      // manual gate's row never carries one.
      null,
    )
  })

  it('pauses at the cap and alerts once, not on every poll', async () => {
    mockBalances([pauseThresholdBaseUnits])
    watching([RECEIVER])
    mockPrevious({ balanceBaseUnits: '0', paused: false })

    await usdcTreasuryBalanceJob._runCheck()

    expect(setSpy).toHaveBeenCalledWith(
      RuntimeSettingKey.UsdcTreasury,
      expect.objectContaining({ paused: true }),
      null,
    )
    expect(slackSpy).toHaveBeenCalledTimes(1)
    expect(slackSpy.mock.calls[0][0].title).toContain('auto-paused')

    // The same state again. 288 polls a day that each alert is how the channel
    // that reports a shut payment path gets muted.
    mockBalances([pauseThresholdBaseUnits])
    mockPrevious({
      balanceBaseUnits: pauseThresholdBaseUnits.toString(),
      paused: true,
    })
    await usdcTreasuryBalanceJob._runCheck()

    expect(slackSpy).toHaveBeenCalledTimes(1)
  })

  it('alerts on the way back down', async () => {
    mockBalances([pauseThresholdBaseUnits])
    watching([RECEIVER])
    mockPrevious({ balanceBaseUnits: '0', paused: false })
    await usdcTreasuryBalanceJob._runCheck()

    mockBalances([10n * USDC])
    mockPrevious({
      balanceBaseUnits: pauseThresholdBaseUnits.toString(),
      paused: true,
    })
    await usdcTreasuryBalanceJob._runCheck()

    expect(slackSpy).toHaveBeenCalledTimes(2)
    expect(slackSpy.mock.calls[1][0].title).toContain('auto-resumed')
  })

  it('says nothing on a first poll that finds everything fine', async () => {
    // Starting up is not an event. A deployment that comes up healthy should not
    // post to Slack for it.
    mockBalances([10n * USDC])
    watching([RECEIVER])
    mockPrevious(null)

    await usdcTreasuryBalanceJob._runCheck()

    expect(slackSpy).not.toHaveBeenCalled()
  })

  it('says so on a first poll that finds the cap already exceeded', async () => {
    mockBalances([pauseThresholdBaseUnits * 2n])
    watching([RECEIVER])
    mockPrevious(null)

    await usdcTreasuryBalanceJob._runCheck()

    expect(slackSpy).toHaveBeenCalledTimes(1)
    expect(slackSpy.mock.calls[0][0].title).toContain('auto-paused')
  })

  it('writes nothing when the chain read fails', async () => {
    mockBalances(new Error('rpc down'))
    watching([RECEIVER])
    mockPrevious({ balanceBaseUnits: '0', paused: false }, true)

    await usdcTreasuryBalanceJob._runCheck()

    // The row's AGE is the outage signal. A write on failure would refresh
    // updated_at, and "balance unknown" — the fail-closed state — would be
    // unreachable.
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('alerts once when the failure has outlived the stale window', async () => {
    mockBalances(new Error('rpc down'))
    watching([RECEIVER])
    mockPrevious({ balanceBaseUnits: '0', paused: false }, true)

    await usdcTreasuryBalanceJob._runCheck()
    // Still down on the next poll: one alert, not one every five minutes.
    await usdcTreasuryBalanceJob._runCheck()

    expect(slackSpy).toHaveBeenCalledTimes(1)
    expect(slackSpy.mock.calls[0][0].title).toContain('unknown')
  })

  it('stays quiet on a single failed poll inside the stale window', async () => {
    mockBalances(new Error('rate limited'))
    watching([RECEIVER])
    // A recent good reading still stands, so the gate keeps its value and nobody
    // needs waking for one dropped poll.
    mockPrevious({ balanceBaseUnits: '0', paused: false }, false)

    await usdcTreasuryBalanceJob._runCheck()

    expect(setSpy).not.toHaveBeenCalled()
    expect(slackSpy).not.toHaveBeenCalled()
  })

  it('writes nothing when no address can be resolved', async () => {
    const readSpy = mockBalances([1n * USDC])
    watching([])

    await usdcTreasuryBalanceJob._runCheck()

    // Summing an empty list to zero would report an empty treasury and hold the
    // gate open on no evidence at all.
    expect(setSpy).not.toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('reads the balance of every watched address', async () => {
    const readSpy = mockBalances([1n * USDC, 2n * USDC])
    watching([RECEIVER, SECOND_ADDRESS])
    mockPrevious(null)

    await usdcTreasuryBalanceJob._runCheck()

    expect(readSpy.mock.calls.map((call) => call[0])).toEqual([
      RECEIVER,
      SECOND_ADDRESS,
    ])
  })

  it('ignores a stale previous reading when deciding the gate', async () => {
    mockBalances([1n * USDC])
    watching([RECEIVER])
    // A paused gate, from a reading too old to trust: the balance may have moved
    // anywhere since, so it is not previous state — and a fresh reading well
    // under the cap opens the gate on its own evidence.
    mockPrevious({ balanceBaseUnits: '0', paused: true }, true)

    await usdcTreasuryBalanceJob._runCheck()

    expect(setSpy).toHaveBeenCalledWith(
      RuntimeSettingKey.UsdcTreasury,
      expect.objectContaining({ paused: false }),
      null,
    )
  })

  it('never writes the manual gate key', async () => {
    // The latching invariant, mechanically: the automatic writer has no path to
    // the human switch. The tempting refactor — one shared `paused` boolean —
    // destroys it silently.
    mockBalances([1n * USDC])
    watching([RECEIVER])
    mockPrevious(null)

    await usdcTreasuryBalanceJob._runCheck()

    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy.mock.calls[0][0]).toBe(RuntimeSettingKey.UsdcTreasury)
  })

  it('does not start without a USDC configuration', () => {
    config.ethereum.usdcReceiverAddress = undefined
    const stateSpy = jest.spyOn(UsdcPaymentsUseCases, 'getTreasuryState')

    usdcTreasuryBalanceJob.start()

    // A deployment that does not sell USDC has nothing to poll, and should not
    // hold an Ethereum endpoint open to find that out.
    expect(stateSpy).not.toHaveBeenCalled()
  })

  it('polls immediately on start rather than after one interval', async () => {
    // The gate fails closed while the balance is unknown, so waiting five
    // minutes after every deploy would shut the purchase path for five minutes
    // after every deploy.
    const readSpy = mockBalances([1n * USDC])
    watching([RECEIVER])
    mockPrevious(null)

    usdcTreasuryBalanceJob.start()
    // start() fires the first check without awaiting it.
    await new Promise((resolve) => setImmediate(resolve))

    expect(readSpy).toHaveBeenCalledTimes(1)
  })

  it('ignores a second start rather than doubling the poll', async () => {
    const readSpy = mockBalances([1n * USDC, 1n * USDC])
    watching([RECEIVER])
    mockPrevious(null)

    usdcTreasuryBalanceJob.start()
    usdcTreasuryBalanceJob.start()
    await new Promise((resolve) => setImmediate(resolve))

    // One poll, and — more to the point — one interval: a second one would be
    // unreachable by stop() and would keep polling, and alerting, for the life
    // of the process.
    expect(readSpy).toHaveBeenCalledTimes(1)
  })
})
