import { CreditBalance, PaymentMethod } from '@auto-drive/models'
import { getDatabase } from '../../drivers/pg.js'

// Queries behind the usage reports (#893). Sums come back as decimal strings
// and are passed on as such.
//
// interactions.created_at is a `timestamp` holding the session's local time,
// so instants are converted to that in SQL. Comparing it as timestamptz instead
// would also keep its indexes from being used.
const local = (param: string) => `${param}::timestamptz::timestamp`

// The bytes an interaction drew from credit batches and their AI3 value at
// each batch's price. Free credits have no intent and are valued at 0. Both
// NULL when it has no consumption rows.
const CONSUMPTION = `LEFT JOIN LATERAL (
    SELECT SUM(c.bytes) AS bytes,
           SUM(c.bytes * COALESCE(it.shannons_per_byte, 0)) AS value
    FROM interaction_credit_consumption c
    JOIN purchased_credits pc ON pc.id = c.purchased_credit_id
    LEFT JOIN intents it ON it.id = pc.intent_id
    WHERE c.interaction_id = i.id
  ) v ON true`

const inRange = (from: string, to: string) => `i.type IN ('upload', 'download')
    AND i.created_at >= ${local(from)}
    AND i.created_at < ${local(to)}`

export type InteractionGroup = {
  type: 'upload' | 'download'
  source: 'free_tier' | 'purchased' | 'free_credits'
  apiKeyId: string | null
  customerReference: string | null
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
    source: 'free_tier' | 'purchased' | 'free_credits'
    api_key_id: string | null
    customer_reference: string | null
    after_attribution_start: boolean
    count: string
    bytes: string
    valued_bytes: string
    value: string
  }>(
    `SELECT i.type, i.source, i.api_key_id, i.customer_reference,
            COALESCE(i.created_at >= ${local('$4')}, false)
              AS after_attribution_start,
            COUNT(*) AS count,
            SUM(i.size) AS bytes,
            COALESCE(SUM(v.bytes), 0) AS valued_bytes,
            COALESCE(SUM(v.value), 0) AS value
     FROM interactions i
     ${CONSUMPTION}
     WHERE i.account_id = $1 AND ${inRange('$2', '$3')}
     GROUP BY 1, 2, 3, 4, 5`,
    [accountId, from, to, attributionStart],
  )

  return result.rows.map((row) => ({
    type: row.type,
    source: row.source,
    apiKeyId: row.api_key_id,
    customerReference: row.customer_reference,
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

// Batches purchased for the account in the range, whoever paid for them. Free
// credits have no intent and are left out.
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

// The account's upload bytes in credit batches at `from` and `to`, and what
// moved in between. Batches are purchases and free credits alike, so `granted`
// is both.
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
// yet; an account deletion that forfeits it brings the expiry forward), or at
// its refund if that came first. A refund after expiry moves no bytes, since
// they had already expired.
//
// A batch refunded before refunds recorded their bytes has its leftover taken
// as everything not in its consumption rows, which is exact only if it was
// granted after attribution.
//
// Purchased and free credits are balanced apart (`free`), so neither figure
// mixes the two.
const getBalance = async (
  accountId: string,
  from: Date,
  to: Date,
  free: boolean,
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
       WHERE pc.account_id = $1 AND (pc.intent_id IS NULL) = $4
       GROUP BY c.purchased_credit_id
     ), batches AS (
       SELECT pc.purchased_at,
              pc.upload_bytes_original AS original,
              -- Monthly free credits issued by a change to the monthly
              -- amount, in its transaction, and those it ended: adjusted,
              -- not granted or expired.
              (pc.grant_period IS NOT NULL AND EXISTS (
                SELECT 1 FROM account_terms_changes t
                WHERE t.account_id = pc.account_id
                  AND t.field = 'monthly_free_upload_bytes'
                  AND t.created_at = pc.purchased_at)) AS by_change,
              pc.superseded_at IS NOT NULL AS superseded,
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
       WHERE pc.account_id = $1 AND (pc.intent_id IS NULL) = $4
     )
     SELECT
       COALESCE(SUM(leftover + since_from) FILTER (
         WHERE purchased_at < $2 AND ended_at >= $2), 0)::text AS opening,
       COALESCE(SUM(original) FILTER (
         WHERE NOT by_change AND purchased_at >= $2 AND purchased_at < $3),
         0)::text AS granted,
       (COALESCE(SUM(original) FILTER (
          WHERE by_change AND purchased_at >= $2 AND purchased_at < $3), 0)
        - COALESCE(SUM(leftover) FILTER (
          WHERE superseded AND ended_at >= $2 AND ended_at < $3), 0))::text
         AS adjusted,
       COALESCE(SUM(since_from - since_to), 0)::text AS consumed,
       COALESCE(SUM(leftover) FILTER (
         WHERE NOT refunded AND NOT superseded
           AND ended_at >= $2 AND ended_at < $3), 0)::text AS expired,
       COALESCE(SUM(leftover) FILTER (
         WHERE refunded AND ended_at >= $2 AND ended_at < $3), 0)::text
         AS refunded,
       COALESCE(SUM(leftover + since_to) FILTER (
         WHERE purchased_at < $3 AND ended_at >= $3), 0)::text AS closing
     FROM batches`,
    [accountId, from, to, free],
  )
  return result.rows[0]
}

export type InteractionRow = {
  id: string
  // The stored local time as text, which keeps its microseconds for paging.
  cursor: string
  created_at: Date
  type: 'upload' | 'download'
  source: 'free_tier' | 'purchased' | 'free_credits'
  size: string
  cid: string | null
  api_key_id: string | null
  customer_reference: string | null
  value: string | null
}

// One page of the account's interactions in the range, in time order, after
// the interaction `after` (a previous page's last row). The (account_id,
// created_at, id) index returns the rows in this order, so a page reads only
// its own rows.
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
            i.type, i.source, i.size, i.cid, i.api_key_id,
            i.customer_reference, v.value
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
  free_credit_bytes: string
  download_bytes: string
  granted_bytes: string
  free_credits_granted_bytes: string
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
              COALESCE(SUM(i.size) FILTER (
                WHERE i.type = 'upload' AND i.source = 'free_credits'), 0)
                AS free_credit_bytes,
              COALESCE(SUM(i.size) FILTER (WHERE i.type = 'download'), 0)
                AS download_bytes
       FROM interactions i
       ${CONSUMPTION}
       WHERE ${inRange('$1', '$2')}
         AND (NOT $3::boolean OR i.account_id IN (
           SELECT id FROM accounts WHERE is_partner))
       GROUP BY i.account_id
     ), grants AS (
       SELECT account_id,
              COALESCE(SUM(upload_bytes_original) FILTER (
                WHERE intent_id IS NOT NULL), 0) AS granted_bytes,
              COALESCE(SUM(upload_bytes_original) FILTER (
                WHERE intent_id IS NULL), 0) AS free_credits_granted_bytes
       FROM purchased_credits
       WHERE purchased_at >= $1 AND purchased_at < $2
       GROUP BY account_id
     )
     SELECT a.id AS account_id, a.organization_id, a.is_partner,
            COALESCE(u.upload_count, 0) AS upload_count,
            COALESCE(u.upload_bytes, 0) AS upload_bytes,
            COALESCE(u.ai3_value, 0) AS ai3_value,
            COALESCE(u.free_credit_bytes, 0) AS free_credit_bytes,
            COALESCE(u.download_bytes, 0) AS download_bytes,
            COALESCE(g.granted_bytes, 0) AS granted_bytes,
            COALESCE(g.free_credits_granted_bytes, 0)
              AS free_credits_granted_bytes
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

export type FreeCreditRow = {
  batch_id: string
  kind: 'free_one_time' | 'free_monthly'
  purchased_at: Date
  granted_by: string | null
  grant_reason: string | null
  grant_period: string | null
  upload_bytes_original: string
  expires_at: Date
}

// Free credit batches granted to the account in the range.
const getFreeCredits = async (
  accountId: string,
  from: Date,
  to: Date,
): Promise<FreeCreditRow[]> => {
  const db = await getDatabase()
  const result = await db.query<FreeCreditRow>(
    `SELECT id AS batch_id,
            CASE WHEN grant_period IS NULL THEN 'free_one_time'
                 ELSE 'free_monthly' END AS kind,
            purchased_at, granted_by, grant_reason,
            to_char(grant_period, 'YYYY-MM-DD') AS grant_period,
            upload_bytes_original, expires_at
     FROM purchased_credits
     WHERE account_id = $1
       AND intent_id IS NULL
       AND purchased_at >= $2
       AND purchased_at < $3
     ORDER BY purchased_at, id`,
    [accountId, from, to],
  )
  return result.rows
}

export type FreeCreditChangeBatchRow = {
  batch_id: string
  purchased_at: Date
  superseded_at: Date | null
  expires_at: Date
  grant_period: string | null
  upload_bytes_original: string
  upload_bytes_remaining: string
  granted_by: string | null
  grant_reason: string | null
}

export type MonthlyTermsChangeRow = {
  created_at: Date
  old_value: string | null
  new_value: string | null
  changed_by: string
  reason: string | null
}

/**
 * What the free credit changes in the range are made of: the free batches
 * granted, ended by a change to the monthly amount, or expired unused in it,
 * and the changes to the monthly amount. A change writes its terms change,
 * ends the month's batch and issues the new one in one transaction, so all
 * three have the same time.
 */
const getFreeCreditChanges = async (
  accountId: string,
  from: Date,
  to: Date,
): Promise<{
  batches: FreeCreditChangeBatchRow[]
  termsChanges: MonthlyTermsChangeRow[]
}> => {
  const db = await getDatabase()
  const [batches, termsChanges] = await Promise.all([
    db.query<FreeCreditChangeBatchRow>(
      `SELECT id AS batch_id, purchased_at, superseded_at, expires_at,
              to_char(grant_period, 'YYYY-MM-DD') AS grant_period,
              upload_bytes_original, upload_bytes_remaining,
              granted_by, grant_reason
       FROM purchased_credits
       WHERE account_id = $1
         AND intent_id IS NULL
         AND ((purchased_at >= $2 AND purchased_at < $3)
           OR (superseded_at >= $2 AND superseded_at < $3)
           OR (superseded_at IS NULL AND upload_bytes_remaining > 0
               AND expires_at >= $2 AND expires_at < $3))`,
      [accountId, from, to],
    ),
    db.query<MonthlyTermsChangeRow>(
      `SELECT created_at, old_value, new_value, changed_by, reason
       FROM account_terms_changes
       WHERE account_id = $1
         AND field = 'monthly_free_upload_bytes'
         AND created_at >= $2
         AND created_at < $3`,
      [accountId, from, to],
    ),
  ])
  return { batches: batches.rows, termsChanges: termsChanges.rows }
}

export const usageReportsRepository = {
  getInteractionGroups,
  getPurchases,
  getFreeCredits,
  getFreeCreditChanges,
  getBalance,
  getInteractionsPage,
  getAccountSummaries,
}
