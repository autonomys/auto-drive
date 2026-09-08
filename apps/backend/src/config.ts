import 'dotenv/config'
import { FeatureFlag } from './core/featureFlags/index.js'
import { AccountModel } from '@auto-drive/models'
import {
  optionalBoolEnvironmentVariable,
  env,
  positiveIntEnv,
} from './shared/utils/misc.js'
import { getAddress, isAddress } from 'viem'

const DEFAULT_MEMORY_CACHE_MAX_SIZE = BigInt(1024 ** 3) // 1GB

const DEFAULT_CACHE_MAX_SIZE = 10 * 1024 ** 3 // 10GB
const DEFAULT_CACHE_TTL = 0 // No TTL

const ONE_MiB = 1024 ** 2
const ONE_HUNDRED_MiB = ONE_MiB * 100
const FIVE_GiB = 1024 ** 3 * 5

/**
 * An optional address variable, trimmed and validated.
 *
 * Trimmed because these values arrive from files far more often than from a
 * shell: a Kubernetes secret mounted as a file, a Parameter Store value, a
 * hand-edited .env — all of them routinely carry a trailing newline or space.
 * Validated because "present" and "usable" have to be the same question here.
 * The payment watcher normalises addresses through viem's getAddress, which
 * THROWS on whitespace, on a truncated hex string, and on a missing 0x
 * prefix — so a truthiness check would call such a value configured while the
 * watcher refused to build on it, and the whole point of the
 * configured/not-configured split is that quoting and watching agree.
 *
 * Returns undefined for anything unusable, which reads to every consumer as
 * "not set". The variable is named in a log line at startup rather than
 * swallowed silently — see invalidAddressEnvironmentVariables below.
 */
const invalidAddressEnvVars: string[] = []

export const addressEnv = (
  name: string,
  raw?: string,
): string | undefined => {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return undefined
  }
  if (!isAddress(trimmed)) {
    invalidAddressEnvVars.push(name)
    return undefined
  }
  return trimmed
}

/**
 * An optional string variable, trimmed, where empty means "not set".
 *
 * The distinction dotenv erases: `KEY=` in a .env file parses to `''`, not
 * undefined, so a consumer testing `!== undefined` treats a key the operator
 * left blank as configured and hands the empty string to a parser. Every
 * `.env.sample` entry ships blank, so that is the normal shape of a deployment
 * configured the documented way.
 */
export const optionalTrimmedEnv = (raw?: string): string | undefined =>
  raw?.trim() || undefined

/**
 * A comma-separated list of raw address strings, trimmed, empties dropped.
 *
 * Deliberately NOT validated here, unlike `addressEnv`. Its consumer — the
 * treasury cap — measures a SUM, so a dropped entry counts as a zero balance and
 * silently lets the treasury hold more un-hedged USDC than configured. Validation
 * therefore belongs where an unusable entry can be turned into a closed gate
 * rather than a smaller number: see `treasuryAddresses` in core/payments/usdc.ts.
 *
 * `isAddress` would also be the wrong test here: it defaults to `strict: true`,
 * which rejects an all-uppercase address that `getAddress` accepts and that any
 * block explorer will happily hand an operator.
 */
export const rawListEnv = (raw?: string): string[] =>
  (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value)

export const config = {
  postgres: {
    url: env('DATABASE_URL'),
  },
  express: {
    port: Number(env('PORT', '3000')),
    requestSizeLimit: env('REQUEST_SIZE_LIMIT', '200mb'),
    corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
  },
  chain: {
    endpoint: env('RPC_ENDPOINT', 'ws://localhost:9944'),
    privateKeysPath: env('PRIVATE_KEYS_PATH', '//Alice'),
    // Number of additional blocks that must build on top of a transaction's
    // inclusion block before we treat it as durably published. Autonomys uses
    // Nakamoto-style (probabilistic) consensus, so an `isInBlock` transaction
    // can still be dropped by a chain reorg. The largest observed reorg is ~12
    // blocks; 25 (~2.5 min at 6s/block) leaves comfortable headroom. Recording
    // publication before this depth is what produced the phantom nodes in #706.
    // Falls back to 25 for missing/invalid values so confirmation logic never
    // compares against NaN (which would never complete) or queries the head.
    confirmationDepth: positiveIntEnv('CHAIN_CONFIRMATION_DEPTH', 25),
    // Upper bound for how long a single transaction may wait to be confirmed.
    // The budget must cover BOTH time-to-inclusion (which can be several blocks
    // under mempool/nonce-queue congestion) AND confirmationDepth blocks on top
    // of it. At 25 blocks * ~6s the confirmation phase alone is ~150s; the
    // 5-minute default leaves room for inclusion latency. Raise this if you
    // increase confirmationDepth or run under sustained heavy load.
    transactionTimeoutMs: positiveIntEnv('CHAIN_TRANSACTION_TIMEOUT_MS', 300000),
    // Safety-net cadence for the confirmation watch. Confirmation is normally
    // driven by a new-heads subscription, but a WebSocket reconnect can leave
    // that subscription silently dead while the chain keeps advancing — so
    // `head >= inclusion + confirmationDepth` is never observed and the tx
    // hangs until transactionTimeoutMs, is retried with the same nonce,
    // re-included, and stalls again. In addition to the subscription, the head
    // is polled on this interval and the same confirmation check is run, so
    // confirmation still completes when the subscription stops delivering.
    // Roughly one block time keeps the degraded path about as timely as the
    // healthy one; the cost is one `getHeader` per in-flight tx per interval.
    // Falls back to 6000ms for missing/invalid values so the poll never stalls.
    confirmationPollIntervalMs: positiveIntEnv(
      'CHAIN_CONFIRMATION_POLL_INTERVAL_MS',
      6000,
    ),
  },
  memoryDownloadCache: {
    maxCacheSize: Number(
      env('MEMORY_DOWNLOAD_CACHE_MAX_SIZE', DEFAULT_MEMORY_CACHE_MAX_SIZE.toString()),
    ),
  },
  objectMappingArchiver: {
    url: env('OBJECT_MAPPING_ARCHIVER_URL'),
    step: Number(env('OBJECT_MAPPING_ARCHIVER_STEP', '1000')),
  },
  reconciliation: {
    intervalMs: Number(env('RECONCILIATION_INTERVAL_MS', '300000')), // 5 minutes
  },
  publishing: {
    // Backstop timeout for a single on-chain publishing task (publish-nodes /
    // ensure-object-published) on the publish-manager worker. The per-transaction
    // timeout in transactionManager is re-armed on every `isInBlock`, so a
    // transaction that is perpetually re-included (the failure mode this worker
    // isolates) never settles and its handler never returns — holding a prefetch
    // slot indefinitely. This handler-level timeout aborts such a task so it
    // retries with a fresh nonce, turning a permanent stall into a bounded retry
    // (and eventually publish-errors) instead of a silent deadlock of the whole
    // publish worker.
    //
    // It must sit comfortably ABOVE the legitimate worst case so it never fires
    // for merely-slow batches: a batch is up to PUBLISH_BATCH_SIZE (50) remarks,
    // drained through the shared pLimit(maxConcurrentUploads) across all in-flight
    // tasks, each transaction taking ~confirmationDepth blocks (plus inclusion
    // latency) to confirm. The 60-minute default clears a heavy multi-batch
    // backlog with headroom; raise it if you raise confirmationDepth /
    // transactionTimeoutMs or run under sustained congestion. The real cure is
    // the confirmation-watch fix (separate PR); this is containment.
    taskTimeoutMs: positiveIntEnv('PUBLISH_TASK_TIMEOUT_MS', 3600000),
  },
  publishingRecovery: {
    intervalMs: Number(env('PUBLISHING_RECOVERY_INTERVAL_MS', '300000')), // 5 minutes
    maxObjectsPerCycle: Number(env('PUBLISHING_RECOVERY_MAX_PER_CYCLE', '5')),
    // Only consider objects "stuck" if their most recent published block is
    // this many blocks behind the chain head. At ~6s block time, 1000 blocks
    // ≈ 1.7 hours — generous enough to not interfere with slow-but-active
    // publishing, while catching genuinely stalled objects.
    stalenessThresholdBlocks: Number(env('PUBLISHING_RECOVERY_STALENESS_BLOCKS', '1000')),
    // Skip a recovery cycle when publish-manager already holds more than this
    // many ready (not-yet-started) tasks. Recovery's output (publish-nodes)
    // lands on publish-manager, so an unchecked recovery would keep piling
    // duplicate publish tasks onto a saturated queue while confirmations are
    // stalled, growing the backlog without bound. A threshold (not > 0) is
    // deliberate: publish-manager legitimately holds a shallow backlog while
    // batches await confirmation, and that must not suppress recovery.
    publishManagerBacklogLimit: Number(env('PUBLISHING_RECOVERY_PUBLISH_BACKLOG_LIMIT', '100')),
  },
  migrationRecovery: {
    intervalMs: Number(env('MIGRATION_RECOVERY_INTERVAL_MS', '300000')), // 5 minutes
    maxUploadsPerCycle: Number(env('MIGRATION_RECOVERY_MAX_PER_CYCLE', '50')),
    // An upload counts as "stuck" only after sitting in `migrating` longer
    // than this window. It must comfortably exceed normal migrate processing
    // time so an in-flight migration is never re-driven (processMigration is
    // not concurrency-guarded). Each recovery attempt also stamps
    // updated_at=now(), so this doubles as the per-upload retry interval — a
    // genuinely failing upload is re-tried at most once per window rather than
    // every cycle.
    stalenessMs: Number(env('MIGRATION_RECOVERY_STALENESS_MS', '1800000')), // 30 minutes
  },
  uploads: {
    // How long a completion claim (status=completing) is respected before
    // another completeUpload call may take it over. Only reached when a process
    // dies mid-completion, since the claim is released on both success and
    // failure — so this should comfortably exceed the time it takes to derive
    // the root IPLD node for the largest expected upload, or a slow completion
    // can be claimed a second time while it is still running.
    //
    // That second run no longer duplicates the root blockstore node:
    // blockstore_root_node_unique_idx plus the ON CONFLICT DO NOTHING on the
    // insert make the write idempotent, so this value is a liveness knob, not
    // the thing standing between us and a corrupt row.
    completionClaimStaleMs: Number(
      env('UPLOAD_COMPLETION_CLAIM_STALE_MS', '3600000'),
    ), // 1 hour
  },
  filesGateway: {
    url: env('FILES_GATEWAY_URL'),
    token: env('FILES_GATEWAY_TOKEN'),
    fetchTimeoutMs: Number(
      env('FILES_GATEWAY_FETCH_TIMEOUT_MS', '60000'),
    ),
  },
  authService: {
    url: env('AUTH_SERVICE_URL', 'http://localhost:3030'),
    token: env('AUTH_SERVICE_API_KEY'),
  },
  cache: {
    dir: env('CACHE_DIR', './.cache'),
    maxSize: Number(env('CACHE_MAX_SIZE', DEFAULT_CACHE_MAX_SIZE.toString())),
    ttl: Number(env('CACHE_TTL', DEFAULT_CACHE_TTL.toString())),
  },
  rabbitmq: {
    url: env('RABBITMQ_URL'),
    prefetch: Number(env('RABBITMQ_PREFETCH', '10')),
    keepAliveInterval: Number(env('RABBITMQ_KEEP_ALIVE_INTERVAL', '60000')),
  },
  // Alerting for tasks that exhausted their retries. Without a consumer the
  // error queues grow forever and nobody finds out a task died.
  slack: {
    // Incoming-webhook URL. The channel is encoded in the URL, so there is no
    // separate channel setting. Unset disables alerting *and* the error-queue
    // consumers, so failures stay queued instead of being acked away unreported
    // (see EventRouter.listenTaskErrors).
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    // Failures are batched into one message per window rather than posted
    // individually: a drained backlog would otherwise post hundreds of times.
    //
    // 30 minutes deliberately favours a quiet channel over a fast alert. These
    // are tasks that already exhausted every retry, so nothing is waiting on the
    // notification — but note that a batched failure has already been acked off
    // the queue, so this is also how much alerting a hard crash can lose. Both
    // workers flush on SIGTERM, which covers ordinary deploys.
    alertWindowMs: Number(env('TASK_ERROR_ALERT_WINDOW_MS', '1800000')),
    // Failures listed individually in a batch before collapsing to a count.
    alertMaxItems: Number(env('TASK_ERROR_ALERT_MAX_ITEMS', '10')),
  },
  monitoring: {
    active: env('VICTORIA_ACTIVE', 'false') === 'true',
    victoriaEndpoint: process.env.VICTORIA_ENDPOINT,
    auth: {
      username: process.env.VICTORIA_USERNAME,
      password: process.env.VICTORIA_PASSWORD,
    },
    metricEnvironmentTag: env('METRIC_ENVIRONMENT_TAG', 'chain=unknown'),
  },
  paymentManager: {
    url: env('EVM_CHAIN_ENDPOINT'),
    contractAddress: getAddress(env('EVM_CHAIN_CONTRACT_ADDRESS')),
    chainId: Number(env('EVM_CHAIN_ID', '870')),
    // positiveIntEnv for the same reason as the Ethereum key below: '0' is a
    // truthy string, so `Number(env(..., '6'))` would hand viem 0 and confirm a
    // payment from a receipt with no confirmations. Pre-existing; fixed here
    // because the two chains now share one watcher and should not differ in how
    // safely they read the same setting.
    confirmations: positiveIntEnv('EVM_CHAIN_CONFIRMATIONS', 6),
    checkInterval: positiveIntEnv('EVM_CHAIN_CHECK_INTERVAL', 30000),
    priceMultiplier: Number(env('CREDITS_PRICE_MULTIPLIER', '5.00')),
  },
  // Ethereum mainnet. Distinct from `paymentManager.url`, which points at Auto
  // EVM (chain 870) — two different chains, so keep the endpoints separate.
  // Read directly (not via `env`) so it stays optional: a deployment that does
  // not quote in USDC boots without it, and the consumer fails fast naming this
  // variable the first time it is needed.
  //
  // The three USDC keys are all-or-nothing rather than individually defaulted,
  // and the watcher enforces that at startup (see paymentManager/chains.ts). A
  // default receiver address would be worse than a missing one: it would point
  // a live payment watcher at a contract nobody deployed, and the failure would
  // read as "no payments arriving" rather than "not configured".
  ethereum: {
    rpcUrl: process.env.ETH_CHAIN_ENDPOINT,
    // Blocks that must build on the payment before it is credited. Ethereum is
    // post-Merge, so 2-3 blocks is already economically final and 6 is
    // conservative — but it is the same default as Auto EVM, which keeps one
    // fewer number in the operator's head. ~12s a block, so 6 is ~72s of extra
    // latency on a purchase, which the polling loop makes invisible anyway.
    //
    // positiveIntEnv, not Number(env(...)): `env` only falls back on a FALSY
    // string, so '0' passes through as 0 — and viem resolves
    // waitForTransactionReceipt immediately whenever confirmations <= 1, so a
    // typo'd 0 (or a non-numeric value, via NaN, which fails every `> 1` guard
    // the same way) would credit a payment from a receipt with no confirmations
    // at all. On Ethereum that is credits granted for a transfer a one-block
    // reorg can still remove.
    confirmations: positiveIntEnv('ETH_CHAIN_CONFIRMATIONS', 6),
    // AutoDriveUSDCReceiver. Payments are watched here, and this is the address
    // the frontend sends USDC to. Setting it to a VALID address is what makes
    // this deployment accept USDC — see isUsdcConfigured below.
    usdcReceiverAddress: addressEnv(
      'ETH_USDC_RECEIVER_ADDRESS',
      process.env.ETH_USDC_RECEIVER_ADDRESS,
    ),
    // The ERC20 the receiver was deployed against. Checked against the `token`
    // field of every payment event before it is credited: the receiver only
    // ever transfers its own configured token, so a mismatch means the address
    // below and the deployed contract disagree — and crediting on the strength
    // of a 6-decimal assumption that no longer holds would grant storage for a
    // token nobody was quoted in.
    usdcTokenAddress: addressEnv(
      'USDC_TOKEN_ADDRESS',
      process.env.USDC_TOKEN_ADDRESS,
    ),
  },
  // The two gates that decide whether this deployment is selling storage for
  // USDC right now — as opposed to `featureFlags.flags.payWithUsdc`, which
  // decides WHO may pay in it. Availability and audience are different
  // questions, and conflating them is how an admin exemption (which exists so
  // the path can be driven in production) ends up walking through an incident
  // control.
  //
  // Both gates live in the database, not here: one is flipped by an admin during
  // an incident, and the other is written by a poller in a different process from
  // the one that quotes. See core/payments/usdc.ts.
  usdcPayments: {
    // The manual gate's value ONLY UNTIL an admin first flips it. After that the
    // stored row wins and this variable is inert — say so in .env.sample, or
    // someone will change it in production and watch nothing happen.
    //
    // Defaults to off, deliberately: a deployment that has just learned how to
    // quote USDC should not begin selling it because a variable was left unset.
    enabledByDefault: optionalBoolEnvironmentVariable('USDC_PAYMENTS_ENABLED'),
    // EXTRA addresses whose USDC balances are summed against the cap. The
    // receiver is always counted whether it appears here or not — it is where
    // payments land, so a list that replaced it would measure the cap over
    // addresses the money never reaches.
    //
    // Configurable because a sweep is part of the manual conversion flow: moving
    // USDC to an address outside this set reopens the gate, which is right only
    // if sweeping implies the conversion is imminent. Add the destination here to
    // keep swept-but-unconverted USDC counted against the cap.
    treasuryAddresses: rawListEnv(process.env.USDC_TREASURY_ADDRESSES),
    // The FX-exposure limit, in whole USDC. At or above this the gate closes
    // itself; it is what makes manual conversion safe to run, and what means
    // nobody has to watch a balance.
    //
    // Kept as a raw string and parsed to 6-decimal base units once, in the
    // consumer, exactly as the oracle's USD bounds are: parsing the decimal
    // string directly avoids Number.toString()'s exponential notation and lets
    // the failure name the variable.
    pauseThresholdUsdc: env('USDC_TREASURY_PAUSE_THRESHOLD', '2000'),
    // Where the gate reopens. Defaults to the pause threshold (no hysteresis).
    // Set it lower to stop a balance sitting exactly on the line from flapping
    // the gate — and therefore the alerts — on every poll.
    //
    // `|| undefined` because "present" and "usable" have to be the same question
    // here, and dotenv makes them different: `.env.sample` ships this key with an
    // empty value, and `KEY=` parses to `''`, which is not undefined. Left as-is
    // that empty string would reach the parser, fail it, and stop the gates job
    // from starting at all — so copying the sample file, the documented way to
    // configure a deployment, would leave USDC permanently closed with only an
    // alert to say why. Trimmed for the same reason `addressEnv` is: these values
    // arrive from mounted secrets as often as from a shell.
    resumeThresholdUsdc: optionalTrimmedEnv(
      process.env.USDC_TREASURY_RESUME_THRESHOLD,
    ),
    balanceCheckIntervalMs: positiveIntEnv(
      'USDC_TREASURY_BALANCE_CHECK_INTERVAL_MS',
      300_000,
    ),
    // How old the last successful reading may be before the balance counts as
    // unknown — and unknown fails closed, because an Ethereum outage must not
    // become a way to keep selling past the cap.
    //
    // Three poll intervals: a single failed poll (a rate limit, a restart) is
    // absorbed, three in a row is a fault. A failed poll deliberately writes
    // nothing, so this window is measured against the last SUCCESS.
    balanceMaxStaleMs: positiveIntEnv(
      'USDC_TREASURY_BALANCE_MAX_STALE_MS',
      900_000,
    ),
  },
  priceOracle: {
    // AI3/USD price oracle: the volume-weighted average of the Uniswap WAI3/USDC
    // pool's most recent swaps, read from the pool's published subgraph through
    // The Graph's gateway. See infrastructure/services/priceOracle.
    //
    // Realized fills rather than pool state, because the treasury no longer
    // swaps per intent — USDC accumulates and is converted manually — so what a
    // purchase should be priced against is what the pool has actually been
    // filling at, fee and impact included.
    //
    // Gateway endpoint for the subgraph, and the API key it is queried with.
    // Both read directly (not via `env`) so they stay optional: a deployment
    // that does not quote in USDC boots without them, and the oracle fails fast
    // naming the missing variable the first time a rate is needed.
    subgraphUrl: process.env.GRAPH_SUBGRAPH_URL,
    graphApiKey: process.env.GRAPH_API_KEY,
    // How long a freshly derived rate is served from memory before a refresh.
    // Safe to cache, unlike the spot price this replaced: a minute cannot move
    // an average built from days of fills.
    cacheTtlMs: positiveIntEnv('ORACLE_CACHE_TTL_MS', 60000),
    // Longest a last-good price may be served as a fallback while the window
    // cannot be read. Default: 10 minutes.
    maxStaleMs: positiveIntEnv('ORACLE_MAX_STALE_MS', 600000),
    // Budget for the whole subgraph query, including connect and body read.
    requestTimeoutMs: positiveIntEnv('ORACLE_REQUEST_TIMEOUT_MS', 10000),
    // Cap on how many fills one query may return. NOT the window: the window is
    // selected by time (ORACLE_MAX_WINDOW_AGE_MS, below) in the query itself,
    // and this only bounds the response size.
    //
    // The distinction is the difference between an attacker having to out-trade
    // the market and merely having to out-number a fixed slot count: fills
    // selected by count, then filtered by age, let a burst EVICT history rather
    // than compete with it, since filtering can only shrink the count and never
    // reach past it. So this wants to sit far above any real week: the busiest
    // 7 days in this pool's whole recorded history is 53 fills, against a
    // default of 1000. A full page means the window may have been cut short and
    // is refused rather than averaged, so raise this rather than lower it.
    maxWindowSamples: positiveIntEnv('ORACLE_MAX_WINDOW_SAMPLES', 1000),
    // Fewest swaps that may stand behind a rate, checked both on the raw window
    // and again after the outlier trim. Below this the average is an anecdote.
    minSwapSamples: positiveIntEnv('ORACLE_MIN_SWAP_SAMPLES', 5),
    // Refuse to quote when the most recent swap is older than this: a window
    // can be perfectly well-formed and still describe a market that has since
    // stopped trading. Default: 24 hours.
    maxSwapAgeMs: positiveIntEnv('ORACLE_MAX_SWAP_AGE_MS', 86400000),
    // The window itself: fills older than this are not fetched, and cannot vote.
    // It is what stops a majority of ancient fills from carrying the median — at
    // which point the trim would discard the recent ones as outliers and the rate
    // would come from another era — and, being applied at the source, it is also
    // what makes the window a period rather than a slot count.
    // Default: 7 days, which at this pool's ~1.6 swaps/day normally holds
    // comfortably more than the ORACLE_MIN_SWAP_SAMPLES floor.
    maxWindowAgeMs: positiveIntEnv('ORACLE_MAX_WINDOW_AGE_MS', 604800000),
    // Least time the surviving fills must span. The outlier trim is count-based,
    // so whoever supplies most of the window sets the price; requiring the
    // window to have been HELD across time is what makes that expensive, since
    // it must be defended against everyone else trading in between.
    // Default: 2 hours.
    minWindowSpanMs: positiveIntEnv('ORACLE_MIN_WINDOW_SPAN_MS', 7200000),
    // Refuse to quote when the indexer's own head is older than this. Distinct
    // from the swap-age guard on purpose — an indexer that has stalled and a
    // pool that has gone quiet look identical in the data and need different
    // responses. Default: 15 minutes.
    maxIndexLagMs: positiveIntEnv('ORACLE_MAX_INDEX_LAG_MS', 900000),
    // Least USDC (in whole USDC) the pool must actually HOLD for its fills to be
    // priced from. Depth, not volume: volume is what traded and can be churned in
    // a circle for the fee, while depth has to be put there and left. It is read
    // from the pool's own USDC balance in the same query the swaps come from.
    //
    // Not unmanufacturable — a trader can raise it by buying, which hands the
    // pool USDC and takes AI3 away — but that commits the whole amount as
    // inventory at price risk plus a round trip's fees, against roughly 1% of
    // nominal to churn the same figure in volume. An order of magnitude dearer,
    // not a closed door. Default 1000 USDC, to be re-derived once this pool
    // trades again: it held 2898 USDC on 2026-08-11, having been at zero five
    // days earlier.
    minPoolUsdcDepth: env('ORACLE_MIN_POOL_USDC_DEPTH', '1000'),
    // Least USDC volume (in whole USDC) the surviving samples must total on their
    // LARGER side. Judged one-sided rather than in total because a round trip
    // contributes both legs while committing capital once, so a total is inflated
    // by exactly the churn this floor exists to reject.
    minWindowVolumeUsdc: env('ORACLE_MIN_WINDOW_VOLUME_USDC', '1000'),
    // Drop swaps whose realized price deviates further than this (percent) from
    // the window's median before averaging. Volume weighting alone does not
    // cover a manipulating trade that is simply large — there, its weight is
    // exactly what makes it dangerous.
    maxSwapDeviationPercent: Number(env('ORACLE_MAX_SWAP_DEVIATION', '25')),
    // Sanity bounds (USD per AI3) as plain decimals — kept as raw strings and
    // parsed to the 1e18 scale in the priceOracle module (parsing the string
    // directly avoids Number.toString() exponential notation for small values).
    // A price outside [min, max] is treated as a glitch and dropped.
    minUsdPerAi3: env('ORACLE_MIN_USD_PER_AI3', '0.0001'),
    maxUsdPerAi3: env('ORACLE_MAX_USD_PER_AI3', '100'),
  },
  credits: {
    // How many days a purchased credit row remains valid before expiring.
    // Free-tier and one-off allocation credits are unaffected — they live on
    // accounts.upload_limit / accounts.download_limit and never expire.
    expiryDays: Number(env('CREDIT_EXPIRY_DAYS', '90')),
    // Maximum total purchased credit balance (in bytes) per account, summed
    // across all active purchased_credits rows.
    // Default: 100 GiB — matches the economic protection design document.
    maxBytesPerUser: BigInt(env('MAX_CREDITS_PER_USER', String(100 * 1024 ** 3))),
    // How often (in ms) the credit expiry background job runs.
    expiryCheckIntervalMs: Number(env('CREDIT_EXPIRY_CHECK_INTERVAL', '3600000')),
    // Price-lock window: how many minutes a PENDING intent remains valid.
    // After this window the intent is treated as expired and all operations on
    // it are rejected.  Default: 10 minutes.
    intentExpiryMinutes: Number(env('INTENT_EXPIRY_MINUTES', '10')),
    // Grace period (in minutes past expires_at) after which a PENDING intent is
    // expired even though it carries a tx_hash.
    //
    // A tx_hash used to exempt a row from expiry unconditionally, on the
    // assumption that it means "actively being watched and will resolve". A
    // refused payment is a standing counterexample: the watcher declines it, the
    // row stays PENDING forever, getIntent keeps advertising it as payable long
    // past its price-lock window, and the startup sweep re-watches it on every
    // restart. So is any hash that never confirms at all.
    //
    // 24 hours by default: long enough that a genuinely pending transaction has
    // either confirmed or been dropped by the mempool, so the common slow-
    // confirmation case still settles normally, and short enough that a stranded
    // row is reclaimed within a day rather than never. A payment that confirms
    // after the window is recorded as a mispayment instead of granted — the
    // price lock it was quoted under is long gone by then.
    intentTxGraceMinutes: Number(env('INTENT_TX_GRACE_MINUTES', '1440')),
    // Margin (in percent) added on top of the raw oracle-derived USD cost when
    // quoting a USDC payment. The stored usdRateAtCreation stays the raw market
    // rate; only the amount the user pays includes this margin. Applied in
    // createIntent (USDC path). Default: 5 (%).
    usdQuoteMarginPercent: Number(env('USD_QUOTE_MARGIN', '5')),
  },
  deletion: {
    gracePeriodDays: Number(env('DELETION_GRACE_PERIOD_DAYS', '30')),
    anonymisationCheckIntervalMs: Number(
      env('DELETION_ANONYMISATION_CHECK_INTERVAL', '3600000'),
    ),
  },
  params: {
    maxConcurrentUploads: Number(env('MAX_CONCURRENT_UPLOADS', '40')),
    maxAnonymousDownloadSize: Number(
      env('MAX_ANONYMOUS_DOWNLOAD_SIZE', ONE_HUNDRED_MiB.toString()),
    ),
    optionalAuth: env('OPTIONAL_AUTH', 'false') === 'true',
    defaultAccount: {
      model: env('DEFAULT_ACCOUNT_MODE', AccountModel.OneOff),
      uploadLimit: Number(
        env('DEFAULT_ACCOUNT_UPLOAD_LIMIT', ONE_HUNDRED_MiB.toString()),
      ),
      downloadLimit: Number(
        env('DEFAULT_ACCOUNT_DOWNLOAD_LIMIT', FIVE_GiB.toString()),
      ),
    },
    web3DefaultAccount: {
      uploadLimit: Number(
        env('WEB3_DEFAULT_ACCOUNT_UPLOAD_LIMIT', ONE_MiB.toString()),
      ),
      downloadLimit: Number(
        env('WEB3_DEFAULT_ACCOUNT_DOWNLOAD_LIMIT', ONE_HUNDRED_MiB.toString()),
      ),
    },
    forbiddenExtensions: env('FORBIDDEN_EXTENSIONS', '').split(','),
    taskManagerMaxRetries: Number(env('TASK_MANAGER_MAX_RETRIES', '3')),
    downloadInactivityTimeoutMs: Number(
      env('DOWNLOAD_INACTIVITY_TIMEOUT_MS', '300000'),
    ),
  },
  featureFlags: {
    flags: {
      taskManager: {
        active:
          (optionalBoolEnvironmentVariable('TASK_MANAGER_ACTIVE') ||
            optionalBoolEnvironmentVariable('ALL_SERVICES_ACTIVE')) &&
          !optionalBoolEnvironmentVariable('TASK_MANAGER_DISABLED'),
      } as FeatureFlag,
      objectMappingArchiver: {
        active:
          (optionalBoolEnvironmentVariable('OBJECT_MAPPING_ARCHIVER_ACTIVE') ||
            optionalBoolEnvironmentVariable('ALL_SERVICES_ACTIVE')) &&
          !optionalBoolEnvironmentVariable('OBJECT_MAPPING_ARCHIVER_DISABLED'),
      } as FeatureFlag,
      buyCredits: {
        active: optionalBoolEnvironmentVariable('BUY_CREDITS_ACTIVE'),
        staffOnly: optionalBoolEnvironmentVariable('BUY_CREDITS_STAFF_ONLY'),
      } as FeatureFlag,
      // Pay-with-USDC. Gates the USDC branch of intent creation only; the AI3
      // path is unaffected and `buyCredits` still gates the endpoint itself.
      //
      // Off by default, and deliberately so for longer than the quote code
      // takes to land: creating a USDC intent hands the user a binding amount
      // to transfer, and nothing observes an IntentTokenPaymentReceived event
      // yet, so a quote issued today is one the backend cannot settle.
      //
      // Admins are exempt whatever this says — see featureFlags/isActive.
      //
      // AUDIENCE ONLY. This flag answers "may this caller pay in USDC", and that
      // is all it answers at `isFlagActive` and at `featureFlagMiddleware`.
      // Whether the DEPLOYMENT is selling USDC is a separate question with its
      // own gates (an admin kill switch, the treasury cap, the oracle) which
      // exempt nobody — see core/payments/usdc.ts. The public /features endpoint
      // reports the CONJUNCTION under this key, plus availability on its own
      // under `usdcAvailable`, so a client cannot be shown a path the backend
      // would refuse; every other reader gets audience only.
      payWithUsdc: {
        active: optionalBoolEnvironmentVariable('PAY_WITH_USDC_ACTIVE'),
      } as FeatureFlag,
    },
    allowlistedUsernames: env('STAFF_USERNAME_ALLOWLIST', '<none>')
      .split(',')
      .filter((username) => username)
      .map((username) => username.toLowerCase()),
    staffDomains: env('STAFF_DOMAINS', '<none>')
      .split(',')
      // Remove empty strings
      .filter((domain) => domain)
      .map((domain) => domain.toLowerCase()),
  },
}

/**
 * Whether USDC payments can be handled end to end: quoted, and then observed
 * when they arrive.
 *
 * All three Ethereum keys, not just the receiver, and that distinction is the
 * whole point of this predicate. The payment watcher refuses to build on a
 * partial configuration — but only the process that owns payments ever asks it
 * to, since `start:fe:api` never calls paymentManager.start(). So in the split
 * topology a half-configured deployment leaves the API serving happily while the
 * worker crash-loops, and the API would quote a binding USDC amount that nothing
 * is watching for. That is the exact failure the quote-side guard exists to
 * prevent, so the guard has to test the same thing the watcher is built from.
 *
 * Defined here, next to the keys, so createIntent and getUsdcPaymentWatcher
 * cannot drift apart on what "configured" means. They still respond differently,
 * and should: the API refuses to quote — killing it over a payments variable
 * would take uploads and downloads with it — while the payment worker dies
 * loudly naming what is missing.
 *
 * A function rather than a field so it reads the live values: tests set these
 * keys after this module has loaded, and a snapshot would answer for the
 * environment instead of for the configuration.
 */
/**
 * Names any address variable that was set to something unusable.
 *
 * Discarding an invalid address makes the deployment behave as though USDC
 * were switched off, which is the safe outcome but a confusing one to debug —
 * "I set the receiver and it still refuses to quote". Called from the payment
 * manager's start(), so the process that owns payments says so at boot.
 */
export const invalidAddressEnvironmentVariables = () => [
  // De-duplicated: a variable holding several unusable values is one
  // misconfiguration, not three, and a log line that repeats the same name reads
  // like more than one problem.
  ...new Set(invalidAddressEnvVars),
]

export const isUsdcConfigured = () =>
  Boolean(
    config.ethereum.rpcUrl &&
      config.ethereum.usdcReceiverAddress &&
      config.ethereum.usdcTokenAddress,
  )
