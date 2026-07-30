import 'dotenv/config'
import { FeatureFlag } from './core/featureFlags/index.js'
import { AccountModel } from '@auto-drive/models'
import {
  optionalBoolEnvironmentVariable,
  env,
  positiveIntEnv,
} from './shared/utils/misc.js'
import { getAddress } from 'viem'

const DEFAULT_MEMORY_CACHE_MAX_SIZE = BigInt(1024 ** 3) // 1GB

const DEFAULT_CACHE_MAX_SIZE = 10 * 1024 ** 3 // 10GB
const DEFAULT_CACHE_TTL = 0 // No TTL

const ONE_MiB = 1024 ** 2
const ONE_HUNDRED_MiB = ONE_MiB * 100
const FIVE_GiB = 1024 ** 3 * 5

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
    // separate channel setting. Unset disables alerting (log-only).
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
    confirmations: Number(env('EVM_CHAIN_CONFIRMATIONS', '6')),
    checkInterval: Number(env('EVM_CHAIN_CHECK_INTERVAL', '30000')),
    priceMultiplier: Number(env('CREDITS_PRICE_MULTIPLIER', '5.00')),
  },
  priceOracle: {
    // AI3/USD price oracle (CoinGecko). See infrastructure/services/priceOracle.
    // How long a freshly fetched price is served from memory before a refresh.
    cacheTtlMs: positiveIntEnv('ORACLE_CACHE_TTL_MS', 60000),
    // Longest a last-good price may be served as a fallback while CoinGecko is
    // unavailable. Default: 10 minutes.
    maxStaleMs: positiveIntEnv('ORACLE_MAX_STALE_MS', 600000),
    // CoinGecko HTTP timeout.
    fetchTimeoutMs: positiveIntEnv('ORACLE_FETCH_TIMEOUT_MS', 5000),
    // Drop the quote if CoinGecko's own reported update time is older than this.
    // Default: 5 minutes.
    maxSourceAgeMs: positiveIntEnv('ORACLE_MAX_SOURCE_AGE_MS', 300000),
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
