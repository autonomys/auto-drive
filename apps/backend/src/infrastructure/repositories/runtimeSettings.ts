import { getDatabase } from '../drivers/pg.js'

/**
 * Operational state that must change without a redeploy.
 *
 * Keys are dotted namespaces (`payments.usdc.manual_gate`). Values are whatever
 * JSON the owning use case defines — this layer deliberately knows nothing about
 * their shape, so a new toggle is a use case and not a migration.
 */
export const RuntimeSettingKey = {
  // {"enabled": bool} — the USDC manual kill switch. Written only by an admin,
  // which is what makes it latching.
  UsdcManualGate: 'payments.usdc.manual_gate',
  // {"balanceBaseUnits": string, "paused": bool, "addresses": string[]} — the
  // treasury balance poller's last SUCCESSFUL reading and the gate it derived.
  UsdcTreasury: 'payments.usdc.treasury',
} as const

export type RuntimeSettingKey =
  (typeof RuntimeSettingKey)[keyof typeof RuntimeSettingKey]

export type RuntimeSetting<T> = {
  value: T
  // The admin's public id, or null when a machine wrote it.
  updatedBy: string | null
  updatedAt: Date
  // How long ago the row was written, computed by POSTGRES rather than from the
  // reader's clock. The writer (payment worker) and the readers (API replicas)
  // are different hosts, and this age decides whether the money path is open —
  // so it is not a number worth deriving across two NTP-dependent clocks.
  ageMs: number
}

type DBRow = {
  value: unknown
  updated_by: string | null
  updated_at: Date
  age_ms: string
}

const mapRow = <T>(row: DBRow): RuntimeSetting<T> => ({
  value: row.value as T,
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
  // numeric comes back as a string from pg; the age is milliseconds and always
  // small enough for a float.
  ageMs: Number(row.age_ms),
})

const AGE_MS = '(EXTRACT(EPOCH FROM (NOW() - updated_at)) * 1000)::numeric AS age_ms'

/**
 * One setting, or null when it has never been written.
 *
 * Null is a meaningful answer, not an error: an absent row means the value has
 * never been set, and the consumer decides what that means (for the manual gate
 * it is the environment default; for the treasury it is "unknown", which fails
 * closed).
 */
const get = async <T>(
  key: RuntimeSettingKey,
): Promise<RuntimeSetting<T> | null> => {
  const db = await getDatabase()
  const result = await db.query<DBRow>(
    `SELECT value, updated_by, updated_at, ${AGE_MS}
     FROM runtime_settings WHERE key = $1`,
    [key],
  )
  return result.rows[0] ? mapRow<T>(result.rows[0]) : null
}

/**
 * Write a setting and return what it held BEFORE the write.
 *
 * The previous value is returned rather than discarded because every caller here
 * needs to tell a change from a no-op: a re-clicked admin toggle must not post a
 * Slack alert, and the balance poller must only alert on a transition. Doing it
 * in one statement — rather than a read followed by a write — keeps two
 * concurrent flips from both reporting themselves as the change.
 *
 * `updatedBy` is the admin's public id for a human flip and null for a machine
 * write. The null is a record, not a gap.
 */
const set = async <T>(
  key: RuntimeSettingKey,
  value: T,
  updatedBy: string | null,
): Promise<RuntimeSetting<T> | null> => {
  const db = await getDatabase()
  const result = await db.query<DBRow>(
    `WITH previous AS (
       SELECT key, value, updated_by, updated_at FROM runtime_settings
       WHERE key = $1
     )
     INSERT INTO runtime_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at
     RETURNING
       (SELECT value FROM previous) AS value,
       (SELECT updated_by FROM previous) AS updated_by,
       (SELECT updated_at FROM previous) AS updated_at,
       (SELECT (EXTRACT(EPOCH FROM (NOW() - updated_at)) * 1000)::numeric
        FROM previous) AS age_ms`,
    [key, JSON.stringify(value), updatedBy],
  )

  // A first write has no previous row: the CTE is empty, so every RETURNING
  // subquery is NULL.
  const row = result.rows[0]
  return row && row.value !== null ? mapRow<T>(row) : null
}

export const runtimeSettingsRepository = {
  get,
  set,
}
