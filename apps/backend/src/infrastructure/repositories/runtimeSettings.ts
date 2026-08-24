import { getDatabase } from '../drivers/pg.js'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('repositories:runtimeSettings')

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
  // {"healthy": bool, "reason": string|null, ...} — the same poller's last rate
  // read. Persisted for the same reason the balance is: the process that can
  // observe oracle health is not the process that quotes.
  UsdcOracle: 'payments.usdc.oracle',
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
 * Several settings in one round trip, in the order the keys were given.
 *
 * The composite USDC gate reads three keys on every quote and on every
 * /features call — the hottest path this feature has, on two API tiers. Three
 * queries where one will do is three times the latency and three times the
 * connection-pool pressure for one answer.
 */
const getMany = async (
  keys: RuntimeSettingKey[],
): Promise<(RuntimeSetting<unknown> | null)[]> => {
  if (keys.length === 0) {
    return []
  }

  const db = await getDatabase()
  const result = await db.query<DBRow & { key: string }>(
    `SELECT key, value, updated_by, updated_at, ${AGE_MS}
     FROM runtime_settings WHERE key = ANY($1)`,
    [keys],
  )

  const byKey = new Map(result.rows.map((row) => [row.key, row]))
  // Positional rather than keyed, so a caller destructures in the order it asked
  // and a missing row is a null in place rather than a shifted array.
  return keys.map((key) => {
    const row = byKey.get(key)
    return row ? mapRow<unknown>(row) : null
  })
}

/**
 * Write a setting and return what it held BEFORE the write.
 *
 * The previous value is returned rather than discarded because every caller here
 * needs to tell a change from a no-op: a re-clicked admin toggle must not post a
 * Slack alert, and the balance poller must only alert on a transition. One
 * statement rather than a read followed by a write, so the pair cannot be
 * interleaved by anything in this process.
 *
 * It does NOT serialise concurrent writers, and the difference is worth stating
 * because it looks like it should. Under READ COMMITTED the `previous` CTE reads
 * the statement's snapshot, so a writer that blocks on `ON CONFLICT` still
 * reports the value it saw at the start rather than the one it waited for. Two
 * simultaneous admin flips can therefore both report themselves as the change
 * (two alerts), and two simultaneous FIRST writes can both compare against the
 * environment default (so a closing flip may report no change and post no
 * alert). The stored value is always one of the two writes and the audit row
 * below records both, so this is a reporting limit, not a correctness one — and
 * two admins flipping one switch in the same millisecond is not the failure mode
 * worth a lock on this path.
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

  // Append-only history, written after the fact rather than as part of the
  // statement above.
  //
  // `runtime_settings.updated_by` only ever answers "who has it set now" — the
  // next flip overwrites it. For a money-path kill switch the question asked
  // after an incident is "who turned it off, and when", and the only other
  // records of that are a Slack message and a log line, both of which live under
  // a retention policy rather than in the database.
  //
  // Best-effort on purpose: losing the history must not fail the flip that is
  // trying to stop USDC sales. Machine writes are excluded — 288 treasury polls
  // a day would bury the handful of rows anyone reads.
  if (updatedBy !== null) {
    try {
      await db.query(
        `INSERT INTO runtime_settings_audit (key, value, updated_by)
         VALUES ($1, $2::jsonb, $3)`,
        [key, JSON.stringify(value), updatedBy],
      )
    } catch (error) {
      logger.error(error, 'Failed to record a runtime-setting change')
    }
  }

  // A first write has no previous row: the CTE is empty, so every RETURNING
  // subquery is NULL.
  const row = result.rows[0]
  return row && row.value !== null ? mapRow<T>(row) : null
}

/**
 * Every recorded change to one key, newest first. Admin-facing history.
 */
const getAuditTrail = async (
  key: RuntimeSettingKey,
  limit = 50,
): Promise<
  { value: unknown; updatedBy: string; createdAt: Date }[]
> => {
  const db = await getDatabase()
  const result = await db.query<{
    value: unknown
    updated_by: string
    created_at: Date
  }>(
    `SELECT value, updated_by, created_at FROM runtime_settings_audit
     WHERE key = $1 ORDER BY id DESC LIMIT $2`,
    [key, limit],
  )
  return result.rows.map((row) => ({
    value: row.value,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
  }))
}

export const runtimeSettingsRepository = {
  get,
  getMany,
  set,
  getAuditTrail,
}
