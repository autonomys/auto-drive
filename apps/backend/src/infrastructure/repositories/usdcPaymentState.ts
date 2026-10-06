import { getDatabase } from '../drivers/pg.js'

/**
 * The USDC payment gates as they are stored: an append-only switch a person
 * flips, and one row of readings the payment worker writes.
 *
 * Two tables and two writers, deliberately: nothing here can write the switch
 * except `setSwitch`, which only the admin endpoint calls. That is what makes
 * "only an admin reopens it" a property of the schema rather than a promise in a
 * comment.
 */

/** One entry in the switch's history. The newest is the current value. */
export type SwitchEntry = {
  enabled: boolean
  setBy: string
  setAt: Date
}

export type TreasuryReading = {
  balanceBaseUnits: bigint
  paused: boolean
  addresses: string[]
  checkedAt: Date
  // Computed by POSTGRES, not from the reader's clock: the worker that writes and
  // the API replicas that read are different hosts, and this number decides
  // whether the money path is open.
  ageMs: number
}

export type OracleWindowSummary = {
  sampleCount: number
  buyCount: number
  sellCount: number
  volumeUsdc: string
  oneSidedVolumeUsdc: string
  poolUsdcDepth: string
  newestSwapAt: string
  oldestSwapAt: string
}

export type OracleReading = {
  healthy: boolean
  reason: string | null
  servingStale: boolean
  usdPerAi3: bigint | null
  // Display only — nothing branches on it, which is why it is stored as jsonb.
  window: OracleWindowSummary | null
  checkedAt: Date
  ageMs: number
}

export type GateReadings = {
  treasury: TreasuryReading | null
  oracle: OracleReading | null
}

const AGE_MS = (column: string) =>
  `(EXTRACT(EPOCH FROM (NOW() - ${column})) * 1000)::numeric`

type DBSwitchRow = { enabled: boolean; set_by: string; created_at: Date }

type DBReadingsRow = {
  treasury_balance_base_units: string | null
  treasury_paused: boolean | null
  treasury_addresses: string[] | null
  treasury_checked_at: Date | null
  treasury_age_ms: string | null
  oracle_healthy: boolean | null
  oracle_reason: string | null
  oracle_serving_stale: boolean | null
  oracle_usd_per_ai3: string | null
  oracle_window: OracleWindowSummary | null
  oracle_checked_at: Date | null
  oracle_age_ms: string | null
}

/**
 * The switch's current value, or null when nobody has ever flipped it.
 *
 * Null is a meaningful answer, not an error: it means the value is still the
 * USDC_PAYMENTS_ENABLED boot default, and the caller reports which of the two is
 * in force.
 */
const getSwitch = async (): Promise<SwitchEntry | null> => {
  const db = await getDatabase()
  const result = await db.query<DBSwitchRow>(
    `SELECT enabled, set_by, created_at FROM usdc_payment_switch
     ORDER BY id DESC LIMIT 1`,
  )
  const row = result.rows[0]
  return row
    ? { enabled: row.enabled, setBy: row.set_by, setAt: row.created_at }
    : null
}

/**
 * Record a flip, returning what the switch read BEFORE it.
 *
 * The previous value is what lets a caller tell a change from a no-op — a
 * re-clicked toggle must not post a Slack alert. Two statements rather than one,
 * and that is a deliberate limit rather than an oversight: two admins flipping
 * the same switch in the same instant could both report themselves as the
 * change. The stored history records both flips in order either way, so the cost
 * is a duplicate alert, and a lock on this path would buy nothing against a race
 * nobody has.
 */
const setSwitch = async (
  enabled: boolean,
  setBy: string,
): Promise<SwitchEntry | null> => {
  const previous = await getSwitch()
  const db = await getDatabase()
  await db.query(
    'INSERT INTO usdc_payment_switch (enabled, set_by) VALUES ($1, $2)',
    [enabled, setBy],
  )
  return previous
}

/** Every flip, newest first. The audit trail is the table itself. */
const getSwitchHistory = async (limit = 50): Promise<SwitchEntry[]> => {
  const db = await getDatabase()
  const result = await db.query<DBSwitchRow>(
    `SELECT enabled, set_by, created_at FROM usdc_payment_switch
     ORDER BY id DESC LIMIT $1`,
    [limit],
  )
  return result.rows.map((row) => ({
    enabled: row.enabled,
    setBy: row.set_by,
    setAt: row.created_at,
  }))
}

/**
 * Both readings, with their ages.
 *
 * A reading is present exactly when its `checked_at` is — the table's CHECK
 * constraints make a half-written row impossible, so this needs no validation
 * beyond that one test.
 */
const getReadings = async (): Promise<GateReadings> => {
  const db = await getDatabase()
  const result = await db.query<DBReadingsRow>(
    `SELECT
       treasury_balance_base_units, treasury_paused, treasury_addresses,
       treasury_checked_at,
       ${AGE_MS('treasury_checked_at')} AS treasury_age_ms,
       oracle_healthy, oracle_reason, oracle_serving_stale, oracle_usd_per_ai3,
       oracle_window, oracle_checked_at,
       ${AGE_MS('oracle_checked_at')} AS oracle_age_ms
     FROM usdc_gate_readings WHERE id = 1`,
  )

  const row = result.rows[0]
  if (!row) {
    return { treasury: null, oracle: null }
  }

  return {
    treasury: row.treasury_checked_at
      ? {
          balanceBaseUnits: BigInt(row.treasury_balance_base_units!),
          paused: row.treasury_paused!,
          addresses: row.treasury_addresses ?? [],
          checkedAt: row.treasury_checked_at,
          ageMs: Number(row.treasury_age_ms),
        }
      : null,
    oracle: row.oracle_checked_at
      ? {
          healthy: row.oracle_healthy!,
          reason: row.oracle_reason,
          servingStale: row.oracle_serving_stale ?? false,
          usdPerAi3: row.oracle_usd_per_ai3
            ? BigInt(row.oracle_usd_per_ai3)
            : null,
          window: row.oracle_window,
          checkedAt: row.oracle_checked_at,
          ageMs: Number(row.oracle_age_ms),
        }
      : null,
  }
}

/**
 * Record a treasury reading. Touches only the treasury columns, so the oracle's
 * freshness is not refreshed by a poll that never read a rate — the two ages are
 * independent facts and each has its own consumer.
 */
const saveTreasuryReading = async (reading: {
  balanceBaseUnits: bigint
  paused: boolean
  addresses: string[]
}): Promise<void> => {
  const db = await getDatabase()
  await db.query(
    `INSERT INTO usdc_gate_readings (
       id, treasury_balance_base_units, treasury_paused, treasury_addresses,
       treasury_checked_at
     ) VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       treasury_balance_base_units = EXCLUDED.treasury_balance_base_units,
       treasury_paused = EXCLUDED.treasury_paused,
       treasury_addresses = EXCLUDED.treasury_addresses,
       treasury_checked_at = NOW()`,
    [
      reading.balanceBaseUnits.toString(),
      reading.paused,
      reading.addresses,
    ],
  )
}

/** The same, for the oracle. */
const saveOracleReading = async (reading: {
  healthy: boolean
  reason: string | null
  servingStale: boolean
  usdPerAi3: bigint | null
  window: OracleWindowSummary | null
}): Promise<void> => {
  const db = await getDatabase()
  await db.query(
    `INSERT INTO usdc_gate_readings (
       id, oracle_healthy, oracle_reason, oracle_serving_stale,
       oracle_usd_per_ai3, oracle_window, oracle_checked_at
     ) VALUES (1, $1, $2, $3, $4, $5::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       oracle_healthy = EXCLUDED.oracle_healthy,
       oracle_reason = EXCLUDED.oracle_reason,
       oracle_serving_stale = EXCLUDED.oracle_serving_stale,
       oracle_usd_per_ai3 = EXCLUDED.oracle_usd_per_ai3,
       oracle_window = EXCLUDED.oracle_window,
       oracle_checked_at = NOW()`,
    [
      reading.healthy,
      reading.reason,
      reading.servingStale,
      reading.usdPerAi3?.toString() ?? null,
      reading.window ? JSON.stringify(reading.window) : null,
    ],
  )
}

export const usdcPaymentStateRepository = {
  getSwitch,
  setSwitch,
  getSwitchHistory,
  getReadings,
  saveTreasuryReading,
  saveOracleReading,
}
