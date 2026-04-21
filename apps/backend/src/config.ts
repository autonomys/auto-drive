import 'dotenv/config'
import { FeatureFlag } from './core/featureFlags/index.js'
import { AccountModel } from '@auto-drive/models'
import { optionalBoolEnvironmentVariable, env } from './shared/utils/misc.js'
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
  filesGateway: {
    url: env('FILES_GATEWAY_URL'),
    token: env('FILES_GATEWAY_TOKEN'),
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
    // Default channel prefetch — used by any queue without an explicit
    // override below. Keep conservative: each in-flight message may hold
    // significant memory while the worker processes it.
    prefetch: Number(env('RABBITMQ_PREFETCH', '10')),
    // Per-queue prefetch overrides. `task-manager` handles memory-heavy
    // `publish-nodes` jobs (encoded-node buffers + Substrate subscriptions)
    // so it needs a much smaller concurrency cap than the download queue.
    queuePrefetch: {
      'task-manager': Number(env('RABBITMQ_TASK_MANAGER_PREFETCH', '3')),
      'download-manager': Number(
        env('RABBITMQ_DOWNLOAD_MANAGER_PREFETCH', '10'),
      ),
    } as Record<string, number>,
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
    // How many node CIDs to bundle into a single `publish-nodes` task.
    // Larger batches reduce queue depth and per-task memory overhead
    // (fewer concurrent encoded-node loads, fewer Substrate tx callbacks
    // held in memory). Set to 1 to restore legacy one-task-per-node
    // behaviour.
    publishNodesBatchSize: Number(env('PUBLISH_NODES_BATCH_SIZE', '50')),
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
