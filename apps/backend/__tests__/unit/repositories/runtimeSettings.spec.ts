import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import {
  RuntimeSettingKey,
  runtimeSettingsRepository,
} from '../../../src/infrastructure/repositories/runtimeSettings.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'

// Runs against the migrated TestContainers Postgres (requires Docker), like the
// other repository specs. The age arithmetic and the previous-value RETURNING are
// both SQL, so a mocked database would test nothing that matters here.
describe('Runtime settings repository', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  it('returns null for a key that has never been written', async () => {
    expect(
      await runtimeSettingsRepository.get(RuntimeSettingKey.UsdcManualGate),
    ).toBeNull()
  })

  it('reports no previous value on the first write', async () => {
    const previous = await runtimeSettingsRepository.set(
      RuntimeSettingKey.UsdcManualGate,
      { enabled: true },
      'admin-1',
    )
    expect(previous).toBeNull()

    const setting = await runtimeSettingsRepository.get<{ enabled: boolean }>(
      RuntimeSettingKey.UsdcManualGate,
    )
    expect(setting?.value).toEqual({ enabled: true })
    expect(setting?.updatedBy).toBe('admin-1')
  })

  it('returns the value it replaced, so a caller can tell a change from a no-op', async () => {
    const previous = await runtimeSettingsRepository.set<{ enabled: boolean }>(
      RuntimeSettingKey.UsdcManualGate,
      { enabled: false },
      'admin-2',
    )

    // The value BEFORE this write, with its own attribution — that pair is what
    // makes "flipped by admin-2, was set by admin-1" reportable.
    expect(previous?.value).toEqual({ enabled: true })
    expect(previous?.updatedBy).toBe('admin-1')

    const setting = await runtimeSettingsRepository.get<{ enabled: boolean }>(
      RuntimeSettingKey.UsdcManualGate,
    )
    expect(setting?.value).toEqual({ enabled: false })
    expect(setting?.updatedBy).toBe('admin-2')
  })

  it('records a machine write as a null author', async () => {
    await runtimeSettingsRepository.set(
      RuntimeSettingKey.UsdcTreasury,
      { balanceBaseUnits: '1500000000', paused: false, addresses: ['0xabc'] },
      null,
    )

    const setting = await runtimeSettingsRepository.get(
      RuntimeSettingKey.UsdcTreasury,
    )
    // Not a missing value: the null IS the record that no person was involved,
    // which is what keeps the manual gate's audit line meaningful.
    expect(setting?.updatedBy).toBeNull()
  })

  it('keys are independent — writing one does not touch the other', async () => {
    const manual = await runtimeSettingsRepository.get<{ enabled: boolean }>(
      RuntimeSettingKey.UsdcManualGate,
    )
    // The poller wrote the treasury key in the previous case. The manual gate is
    // still what an admin last set it to, which is the latching invariant: no
    // automatic writer can reach the human switch.
    expect(manual?.value).toEqual({ enabled: false })
    expect(manual?.updatedBy).toBe('admin-2')
  })

  it('measures age from the database clock, not the caller (fresh write ~0ms)', async () => {
    await runtimeSettingsRepository.set(
      RuntimeSettingKey.UsdcTreasury,
      { balanceBaseUnits: '1', paused: false, addresses: [] },
      null,
    )
    const setting = await runtimeSettingsRepository.get(
      RuntimeSettingKey.UsdcTreasury,
    )
    expect(setting?.ageMs).toBeGreaterThanOrEqual(0)
    expect(setting?.ageMs).toBeLessThan(5_000)
  })

  it('reads several keys in one round trip, positionally', async () => {
    // The composite gate reads three keys on every quote and every /features
    // call. Positional rather than keyed, so a caller destructures in the order
    // it asked and a missing row is a null in place rather than a shifted array.
    const [manual, treasury, missing] = await runtimeSettingsRepository.getMany([
      RuntimeSettingKey.UsdcManualGate,
      RuntimeSettingKey.UsdcTreasury,
      RuntimeSettingKey.UsdcOracle,
    ])

    expect(manual?.value).toEqual({ enabled: false })
    expect(treasury?.value).toEqual(
      expect.objectContaining({ paused: false }),
    )
    expect(missing).toBeNull()
  })

  it('carries the same age arithmetic through getMany', async () => {
    const [one] = await runtimeSettingsRepository.getMany([
      RuntimeSettingKey.UsdcManualGate,
    ])
    expect(one?.ageMs).toBeGreaterThanOrEqual(0)
    expect(one?.ageMs).toBeLessThan(60_000)
  })

  it('returns nothing for an empty key list without querying', async () => {
    expect(await runtimeSettingsRepository.getMany([])).toEqual([])
  })

  it('keeps an append-only trail of human changes', async () => {
    await runtimeSettingsRepository.set(
      RuntimeSettingKey.UsdcManualGate,
      { enabled: true },
      'admin-3',
    )

    const trail = await runtimeSettingsRepository.getAuditTrail(
      RuntimeSettingKey.UsdcManualGate,
    )

    // `updated_by` on the setting says who has it set NOW; the question after an
    // incident is who turned it off on Tuesday, and that answer must not be
    // overwritten by the next flip.
    expect(trail.length).toBeGreaterThanOrEqual(3)
    expect(trail[0].updatedBy).toBe('admin-3')
    expect(trail[0].value).toEqual({ enabled: true })
    // Newest first, so the history reads the way an incident review does.
    expect(trail[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      trail[1].createdAt.getTime(),
    )
  })

  it('does not record machine writes', async () => {
    await runtimeSettingsRepository.set(
      RuntimeSettingKey.UsdcTreasury,
      { balanceBaseUnits: '2000000', paused: false, addresses: [] },
      null,
    )

    // 288 treasury polls a day would bury the handful of rows anyone reads.
    expect(
      await runtimeSettingsRepository.getAuditTrail(
        RuntimeSettingKey.UsdcTreasury,
      ),
    ).toEqual([])
  })

  it('ages a stale row in milliseconds', async () => {
    // Backdate the row rather than waiting: the fail-closed rule turns on this
    // number crossing a 15-minute threshold, and a test that sleeps for it is a
    // test nobody runs.
    const db = await getDatabase()
    await db.query(
      `UPDATE runtime_settings SET updated_at = NOW() - interval '20 minutes'
       WHERE key = $1`,
      [RuntimeSettingKey.UsdcTreasury],
    )

    const setting = await runtimeSettingsRepository.get(
      RuntimeSettingKey.UsdcTreasury,
    )
    expect(setting!.ageMs).toBeGreaterThan(19 * 60 * 1000)
    expect(setting!.ageMs).toBeLessThan(21 * 60 * 1000)
  })
})
