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
  publishingRecovery: {
    intervalMs: Number(env('PUBLISHING_RECOVERY_INTERVAL_MS', '300000')), // 5 minutes
    maxObjectsPerCycle: Number(env('PUBLISHING_RECOVERY_MAX_PER_CYCLE', '5')),
    // Only consider objects "stuck" if their most recent published block is
    // this many blocks behind the chain head. At ~6s block time, 1000 blocks
    // ≈ 1.7 hours — generous enough to not interfere with slow-but-active
    // publishing, while catching genuinely stalled objects.
    stalenessThresholdBlocks: Number(env('PUBLISHING_RECOVERY_STALENESS_BLOCKS', '1000')),
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
    // Comma-separated source names (see priceOracle sourceRegistry). Only
    // 'coingecko' is implemented today; the median/bounds/fallback machinery
    // generalises to more sources when adapters are added.
    sources: env('ORACLE_SOURCES', 'coingecko')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    // Minimum healthy sources required to compute a fresh price. Below this the
    // oracle serves the last-good value (if within maxStaleMs) or errors.
    minSources: positiveIntEnv('ORACLE_MIN_SOURCES', 1),
    // How long a freshly computed price is served from memory before a refresh.
    cacheTtlMs: positiveIntEnv('ORACLE_CACHE_TTL_MS', 60000),
    // Longest a last-good price may be served as a fallback when a refresh
    // cannot gather enough healthy sources. Default: 10 minutes.
    maxStaleMs: positiveIntEnv('ORACLE_MAX_STALE_MS', 600000),
    // Per-source HTTP timeout.
    fetchTimeoutMs: positiveIntEnv('ORACLE_FETCH_TIMEOUT_MS', 5000),
    // Drop a source's quote if its own reported update time is older than this.
    // Default: 5 minutes.
    maxSourceAgeMs: positiveIntEnv('ORACLE_MAX_SOURCE_AGE_MS', 300000),
    // Sanity bounds (USD per AI3) as plain decimals — kept as raw strings and
    // parsed to the 1e18 scale in the priceOracle module (parsing the string
    // directly avoids Number.toString() exponential notation for small values).
    // A source value outside [min, max] is treated as a glitch and dropped.
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
