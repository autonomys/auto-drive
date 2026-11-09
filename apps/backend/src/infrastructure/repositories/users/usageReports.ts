import { CreditBalance, PaymentMethod } from '@auto-drive/models'
import { getDatabase } from '../../drivers/pg.js'

// Queries behind the usage reports (#893). Sums come back as decimal strings
// and are passed on as such.
//
// interactions.created_at is a `timestamp` holding the session's local time,
// so instants are converted to that in SQL. Comparing it as timestamptz instead
// would also keep the (type, account_id, created_at) index from being used.
const local = (param: string) => `${param}::timestamptz::timestamp`

// The bytes an interaction drew from purchased batches, and their AI3 value at
// each batch's price. Both NULL when it has no consumption rows.
const CONSUMPTION = `LEFT JOIN LATERAL (
    SELECT SUM(c.bytes) AS bytes, SUM(c.bytes * it.shannons_per_byte) AS value
    FROM interaction_credit_consumption c
    JOIN purchased_credits pc ON pc.id = c.purchased_credit_id
    JOIN intents it ON it.id = pc.intent_id
    WHERE c.interaction_id = i.id
  ) v ON true`

const inRange = (from: string, to: string) => `i.type IN ('upload', 'download')
    AND i.created_at >= ${local(from)}
    AND i.created_at < ${local(to)}`

export type InteractionGroup = {
  type: 'upload' | 'download'
  source: 'free_tier' | 'purchased'
  apiKeyId: string | null
  afterAttributionStart: boolean
  count: number
  bytes: string
  valuedBytes: string
  value: string
}

const getInteractionGroups = async (
  accountId: string,
  from: Date,
  to: Date,
  attributionStart: Date | null,
): Promise<InteractionGroup[]> => {
  const db = await getDatabase()
  const result = await db.query<{
    type: 'upload' | 'download'
    source: 'free_tier' | 'purchased'
    api_key_id: string | null
    after_attribution_start: boolean
    count: string
    bytes: string
    valued_bytes: string
    value: string
  }>(
    `SELECT i.type, i.source, i.api_key_id,
            COALESCE(i.created_at >= ${local('$4')}, false)
              AS after_attribution_start,
            COUNT(*) AS count,
            SUM(i.size) AS bytes,
            COALESCE(SUM(v.bytes), 0) AS valued_bytes,
            COALESCE(SUM(v.value), 0) AS value
     FROM interactions i
     ${CONSUMPTION}
     WHERE i.account_id = $1 AND ${inRange('$2', '$3')}
     GROUP BY 1, 2, 3, 4`,
    [accountId, from, to, attributionStart],
  )

  return result.rows.map((row) => ({
    type: row.type,
    source: row.source,
    apiKeyId: row.api_key_id,
    afterAttributionStart: row.after_attribution_start,
    count: Number(row.count),
    bytes: row.bytes,
    valuedBytes: row.valued_bytes,
    value: row.value,
  }))
}

export type PurchaseRow = {
  batch_id: string
  intent_id: string
  user_public_id: string
  purchased_at: Date
  payment_method: PaymentMethod
  payment_amount: string | null
  token_amount: string | null
  quoted_token_amount: string | null
  quoted_ai3_shannons: string | null
  shannons_per_byte: string
  upload_bytes_original: string
  expires_at: Date
  tx_hash: string | null
  from_address: string | null
  refunded_at: Date | null
  refund_tx_hash: string | null
  refunded_upload_bytes: string | null
}

// Batches granted to the account in the range, whoever paid for them.
const getPurchases = async (
  accountId: string,
  from: Date,
  to: Date,
): Promise<PurchaseRow[]> => {
  const db = await getDatabase()
  const result = await db.query<PurchaseRow>(
    `SELECT pc.id AS batch_id, pc.intent_id, i.user_public_id,
            pc.purchased_at, i.payment_method, i.payment_amount,
            i.token_amount, i.quoted_token_amount, i.quoted_ai3_shannons,
            i.shannons_per_byte, pc.upload_bytes_original, pc.expires_at,
            i.tx_hash, i.from_address, pc.refunded_at, pc.refund_tx_hash,
            pc.refunded_upload_bytes
     FROM purchased_credits pc
     JOIN intents i ON i.id = pc.intent_id
     WHERE pc.account_id = $1
       AND pc.purchased_at >= $2
       AND pc.purchased_at < $3
     ORDER BY pc.purchased_at, pc.id`,
    [accountId, from, to],
  )
  return result.rows
}

// The account's purchased upload bytes at `from` and `to`, and what moved in
// between.
//
// Balances are worked back from each batch's current state, so they are exact
// for any time from which every consumption is recorded, i.e. from attribution
// onwards, even for batches granted before it. At time t a batch holds nothing
// if it was granted at or after t or ended before t. Otherwise it holds its
// leftover plus whatever it gave to uploads from t on.
//
// A batch's leftover is what was never consumed: its remaining bytes, or what a
// refund took back. It leaves the balance when the batch ends: at its expiry
// (consumeUpTo stops drawing on it then, whether or not the expiry job has run
// yet), or at its refund if that came first. A refund after expiry moves no
// bytes, since they had already expired.
//
// A batch refunded before refunds recorded their bytes has its leftover taken
// as everything not in its consumption rows, which is exact only if it was
// granted after attribution.
const getBalance = async (
  accountId: string,
  from: Date,
  to: Date,
): Promise<CreditBalance> => {
  const db = await getDatabase()
  const result = await db.query<CreditBalance>(
    `WITH consumption AS (
       SELECT c.purchased_credit_id,
              SUM(c.bytes) AS total,
              COALESCE(SUM(c.bytes) FILTER (
                WHERE i.created_at >= ${local('$2')}), 0) AS since_from,
              COALESCE(SUM(c.bytes) FILTER (
                WHERE i.created_at >= ${local('$3')}), 0) AS since_to
       FROM interaction_credit_consumption c
       JOIN interactions i ON i.id = c.interaction_id
       JOIN purchased_credits pc ON pc.id = c.purchased_credit_id
       WHERE pc.account_id = $1
       GROUP BY c.purchased_credit_id
     ), batches AS (
       SELECT pc.purchased_at,
              pc.upload_bytes_original AS original,
              CASE
                WHEN pc.refunded_at IS NULL THEN pc.upload_bytes_remaining
                ELSE COALESCE(pc.refunded_upload_bytes,
                              pc.upload_bytes_original - COALESCE(c.total, 0))
              END AS leftover,
              COALESCE(pc.refunded_at < pc.expires_at, false) AS refunded,
              LEAST(pc.expires_at, pc.refunded_at) AS ended_at,
              COALESCE(c.since_from, 0) AS since_from,
              COALESCE(c.since_to, 0) AS since_to
       FROM purchased_credits pc
       LEFT JOIN consumption c ON c.purchased_credit_id = pc.id
       WHERE pc.account_id = $1
     )
     SELECT
       COALESCE(SUM(leftover + since_from) FILTER (
         WHERE purchased_at < $2 AND ended_at >= $2), 0)::text AS opening,
       COALESCE(SUM(original) FILTER (
         WHERE purchased_at >= $2 AND purchased_at < $3), 0)::text AS granted,
       COALESCE(SUM(since_from - since_to), 0)::text AS consumed,
       COALESCE(SUM(leftover) FILTER (
         WHERE NOT refunded AND ended_at >= $2 AND ended_at < $3), 0)::text
         AS expired,
       COALESCE(SUM(leftover) FILTER (
         WHERE refunded AND ended_at >= $2 AND ended_at < $3), 0)::text
         AS refunded,
       COALESCE(SUM(leftover + since_to) FILTER (
         WHERE purchased_at < $3 AND ended_at >= $3), 0)::text AS closing
     FROM batches`,
    [accountId, from, to],
  )
  return result.rows[0]
}

export type InteractionRow = {
  id: string
  // The stored local time as text, which keeps its microseconds for paging.
  cursor: string
  created_at: Date
  type: 'upload' | 'download'
  source: 'free_tier' | 'purchased'
  size: string
  cid: string | null
  api_key_id: string | null
  value: string | null
}

// One page of the account's interactions in the range, in time order, after
// the interaction `after` (a previous page's last row).
const getInteractionsPage = async (
  accountId: string,
  from: Date,
  to: Date,
  after: Pick<InteractionRow, 'cursor' | 'id'> | null,
  limit: number,
): Promise<InteractionRow[]> => {
  const db = await getDatabase()
  const result = await db.query<InteractionRow>(
    `SELECT i.id, i.created_at::text AS cursor,
            i.created_at::timestamptz AS created_at,
            i.type, i.source, i.size, i.cid, i.api_key_id, v.value
     FROM interactions i
     ${CONSUMPTION}
     WHERE i.account_id = $1 AND ${inRange('$2', '$3')}
       AND ($4::timestamp IS NULL OR (i.created_at, i.id) > ($4::timestamp, $5::text))
     ORDER BY i.created_at, i.id
     LIMIT $6`,
    [accountId, from, to, after?.cursor ?? null, after?.id ?? null, limit],
  )
  return result.rows
}

export type AccountSummaryRow = {
  account_id: string
  organization_id: string
  is_partner: boolean
  upload_count: string
  upload_bytes: string
  ai3_value: string
  download_bytes: string
  granted_bytes: string
}

// Headline figures for each account with usage or credits granted in the
// range, most upload bytes first.
const getAccountSummaries = async (
  from: Date,
  to: Date,
  partnersOnly: boolean,
  limit: number,
): Promise<AccountSummaryRow[]> => {
  const db = await getDatabase()
  const result = await db.query<AccountSummaryRow>(
    `WITH usage AS (
       SELECT i.account_id,
              COUNT(*) FILTER (WHERE i.type = 'upload') AS upload_count,
              COALESCE(SUM(i.size) FILTER (WHERE i.type = 'upload'), 0)
                AS upload_bytes,
              COALESCE(SUM(v.value), 0) AS ai3_value,
              COALESCE(SUM(i.size) FILTER (WHERE i.type = 'download'), 0)
                AS download_bytes
       FROM interactions i
       ${CONSUMPTION}
       WHERE ${inRange('$1', '$2')}
         AND (NOT $3::boolean OR i.account_id IN (
           SELECT id FROM accounts WHERE is_partner))
       GROUP BY i.account_id
     ), grants AS (
       SELECT account_id, SUM(upload_bytes_original) AS granted_bytes
       FROM purchased_credits
       WHERE purchased_at >= $1 AND purchased_at < $2
       GROUP BY account_id
     )
     SELECT a.id AS account_id, a.organization_id, a.is_partner,
            COALESCE(u.upload_count, 0) AS upload_count,
            COALESCE(u.upload_bytes, 0) AS upload_bytes,
            COALESCE(u.ai3_value, 0) AS ai3_value,
            COALESCE(u.download_bytes, 0) AS download_bytes,
            COALESCE(g.granted_bytes, 0) AS granted_bytes
     FROM accounts a
     LEFT JOIN usage u ON u.account_id = a.id
     LEFT JOIN grants g ON g.account_id = a.id
     WHERE (u.account_id IS NOT NULL OR g.account_id IS NOT NULL)
       AND (NOT $3 OR a.is_partner)
     ORDER BY COALESCE(u.upload_bytes, 0) DESC, a.id
     LIMIT $4`,
    [from, to, partnersOnly, limit],
  )
  return result.rows
}

export const usageReportsRepository = {
  getInteractionGroups,
  getPurchases,
  getBalance,
  getInteractionsPage,
  getAccountSummaries,
}
