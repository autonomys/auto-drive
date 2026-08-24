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
