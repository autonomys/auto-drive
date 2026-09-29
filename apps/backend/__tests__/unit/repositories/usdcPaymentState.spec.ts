import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { usdcPaymentStateRepository } from '../../../src/infrastructure/repositories/usdcPaymentState.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'

// Runs against the migrated TestContainers Postgres (requires Docker), like the
// other repository specs. The age arithmetic and the CHECK constraints are both
// SQL, so a mocked database would test nothing that matters here.
describe('USDC payment state repository', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  describe('the switch', () => {
    it('reads as unset before anyone has flipped it', async () => {
      // Not "off": unset means the value is the USDC_PAYMENTS_ENABLED boot
      // default, which is a different fact and reported differently.
      expect(await usdcPaymentStateRepository.getSwitch()).toBeNull()
    })

    it('reports no previous value on the first flip', async () => {
      const previous = await usdcPaymentStateRepository.setSwitch(
        true,
        'admin-1',
      )
      expect(previous).toBeNull()

      const current = await usdcPaymentStateRepository.getSwitch()
      expect(current).toEqual(
        expect.objectContaining({ enabled: true, setBy: 'admin-1' }),
      )
    })

    it('returns what it replaced, so a caller can tell a change from a no-op', async () => {
      const previous = await usdcPaymentStateRepository.setSwitch(
        false,
        'admin-2',
      )

      // The value before this flip, with its own attribution — that pair is what
      // makes "flipped by admin-2, was set by admin-1" reportable, and what stops
      // a re-clicked toggle from posting a Slack alert.
      expect(previous).toEqual(
        expect.objectContaining({ enabled: true, setBy: 'admin-1' }),
      )
      expect(await usdcPaymentStateRepository.getSwitch()).toEqual(
        expect.objectContaining({ enabled: false, setBy: 'admin-2' }),
      )
    })

    it('keeps every flip, newest first', async () => {
      const history = await usdcPaymentStateRepository.getSwitchHistory()

      // The table IS the audit trail: for a switch, the current value and its
      // history are the same fact, so there is no second table to keep in step —
      // and no flip that can be overwritten by the next one.
      expect(history.map((entry) => [entry.enabled, entry.setBy])).toEqual([
        [false, 'admin-2'],
        [true, 'admin-1'],
      ])
      expect(history[0].setAt.getTime()).toBeGreaterThanOrEqual(
        history[1].setAt.getTime(),
      )
    })
  })

  describe('the readings', () => {
    it('reads as absent before anything has polled', async () => {
      expect(await usdcPaymentStateRepository.getReadings()).toEqual({
        treasury: null,
        oracle: null,
      })
    })

    it('round-trips a treasury reading, with its age from the database clock', async () => {
      await usdcPaymentStateRepository.saveTreasuryReading({
        balanceBaseUnits: 2_014_000_000n,
        paused: true,
        addresses: ['0xAAA', '0xBBB'],
      })

      const { treasury } = await usdcPaymentStateRepository.getReadings()
      expect(treasury?.balanceBaseUnits).toBe(2_014_000_000n)
      expect(typeof treasury?.balanceBaseUnits).toBe('bigint')
      expect(treasury?.paused).toBe(true)
      expect(treasury?.addresses).toEqual(['0xAAA', '0xBBB'])
      expect(treasury?.ageMs).toBeGreaterThanOrEqual(0)
      expect(treasury?.ageMs).toBeLessThan(5_000)
    })

    it('round-trips an oracle reading beside it', async () => {
      await usdcPaymentStateRepository.saveOracleReading({
        healthy: false,
        reason: 'thin-liquidity',
        servingStale: false,
        usdPerAi3: null,
        window: null,
      })

      const { treasury, oracle } = await usdcPaymentStateRepository.getReadings()
      expect(oracle?.healthy).toBe(false)
      expect(oracle?.reason).toBe('thin-liquidity')
      // And the treasury reading is untouched: one row, but two independent
      // facts.
      expect(treasury?.balanceBaseUnits).toBe(2_014_000_000n)
    })

    it('does not refresh the treasury clock when only the oracle is written', async () => {
      // The two ages have different consumers and different meanings. A poll that
      // read a rate but no balance must not make the balance look fresh — that
      // would be a way to keep selling past the cap through an Ethereum outage.
      const db = await getDatabase()
      await db.query(
        `UPDATE usdc_gate_readings
         SET treasury_checked_at = NOW() - interval '30 minutes' WHERE id = 1`,
      )

      await usdcPaymentStateRepository.saveOracleReading({
        healthy: true,
        reason: null,
        servingStale: false,
        usdPerAi3: 6_400_000_000_000_000n,
        window: null,
      })

      const { treasury, oracle } = await usdcPaymentStateRepository.getReadings()
      expect(treasury!.ageMs).toBeGreaterThan(29 * 60 * 1000)
      expect(oracle!.ageMs).toBeLessThan(5_000)
      expect(oracle!.usdPerAi3).toBe(6_400_000_000_000_000n)
    })

    it('stores the swap window as an opaque display payload', async () => {
      // jsonb precisely because nothing branches on it: eight numbers the admin
      // card renders and no code decides anything from.
      await usdcPaymentStateRepository.saveOracleReading({
        healthy: true,
        reason: null,
        servingStale: true,
        usdPerAi3: 1n,
        window: {
          sampleCount: 7,
          buyCount: 3,
          sellCount: 4,
          volumeUsdc: '1000000',
          oneSidedVolumeUsdc: '600000',
          poolUsdcDepth: '2898000000',
          newestSwapAt: '2026-08-20T00:00:00.000Z',
          oldestSwapAt: '2026-08-14T00:00:00.000Z',
        },
      })

      const { oracle } = await usdcPaymentStateRepository.getReadings()
      expect(oracle?.window?.sampleCount).toBe(7)
      expect(oracle?.window?.poolUsdcDepth).toBe('2898000000')
      expect(oracle?.servingStale).toBe(true)
    })

    it('ages a stale reading in milliseconds', async () => {
      // Backdate rather than wait: the fail-closed rule turns on this number
      // crossing a 15-minute threshold, and a test that sleeps for it is a test
      // nobody runs.
      const db = await getDatabase()
      await db.query(
        `UPDATE usdc_gate_readings
         SET treasury_checked_at = NOW() - interval '20 minutes' WHERE id = 1`,
      )

      const { treasury } = await usdcPaymentStateRepository.getReadings()
      expect(treasury!.ageMs).toBeGreaterThan(19 * 60 * 1000)
      expect(treasury!.ageMs).toBeLessThan(21 * 60 * 1000)
    })
  })

  describe('the schema refuses a half-written reading', () => {
    it('rejects a timestamp without the gate it is supposed to date', async () => {
      // This is the defect the typed schema exists to make impossible. As a JSON
      // document, a reading missing `paused` read as "not paused" under any
      // truthiness test — which OPENS the money gate. Here the database refuses
      // to store it, so no reader has to be careful.
      const db = await getDatabase()
      await expect(
        db.query(
          'UPDATE usdc_gate_readings SET treasury_paused = NULL WHERE id = 1',
        ),
      ).rejects.toThrow('treasury_reading_whole')
    })

    it('rejects a gate without a balance behind it', async () => {
      const db = await getDatabase()
      await expect(
        db.query(
          `UPDATE usdc_gate_readings
           SET treasury_balance_base_units = NULL WHERE id = 1`,
        ),
      ).rejects.toThrow('treasury_reading_whole')
    })

    it('rejects an oracle timestamp with no verdict', async () => {
      const db = await getDatabase()
      await expect(
        db.query(
          'UPDATE usdc_gate_readings SET oracle_healthy = NULL WHERE id = 1',
        ),
      ).rejects.toThrow('oracle_reading_whole')
    })

    it('allows clearing a reading entirely', async () => {
      // Absent is a legitimate state — it is what "nothing has polled yet" looks
      // like, and it fails closed.
      const db = await getDatabase()
      await db.query(
        `UPDATE usdc_gate_readings SET
           treasury_paused = NULL,
           treasury_balance_base_units = NULL,
           treasury_checked_at = NULL
         WHERE id = 1`,
      )

      const { treasury } = await usdcPaymentStateRepository.getReadings()
      expect(treasury).toBeNull()
    })

    it('holds exactly one row of readings', async () => {
      const db = await getDatabase()
      await expect(
        db.query('INSERT INTO usdc_gate_readings (id) VALUES (2)'),
      ).rejects.toThrow()
    })
  })
})
