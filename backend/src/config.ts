import 'dotenv/config'
import { optionalBoolEnvironmentVariable, env } from './utils/misc.js'

const DEFAULT_MAX_CACHE_SIZE = BigInt(10 * 1024 ** 3)

const DEFAULT_CACHE_MAX_SIZE = 10 * 1024 ** 3 // 10GB
const DEFAULT_CACHE_TTL = 1000000 // 1000000 seconds

const HUNDRED_MB = 1024 ** 2 * 100
const FIVE_GB = 1024 ** 3 * 5

export const commonConfig = {
  logLevel: env('LOG_LEVEL', 'info'),
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
    privateKeysPath: env('PRIVATE_KEYS_PATH', '//Alice'), // Might be worth it to limit this to the workers
  },
  // Only for APIs, once /objects/${cid}/download is removed only Download API
  memoryDownloadCache: {
    maxCacheSize: Number(
      env('MEMORY_DOWNLOAD_CACHE_MAX_SIZE', DEFAULT_MAX_CACHE_SIZE.toString()),
    ),
  },
  // Only Download Service
  filesGateway: {
    url: env('FILES_GATEWAY_URL'),
    token: env('FILES_GATEWAY_TOKEN'),
  },
  // Currently, for all except frontend worker
  cache: {
    dir: env('CACHE_DIR', './.cache'),
    maxSize: Number(env('CACHE_MAX_SIZE', DEFAULT_CACHE_MAX_SIZE.toString())),
    ttl: Number(env('CACHE_TTL', DEFAULT_CACHE_TTL.toString())),
  },
  // Common for all
  rabbitmq: {
    url: env('RABBITMQ_URL'),
    prefetch: Number(env('RABBITMQ_PREFETCH', '10')),
  },
  // Common for all
  monitoring: {
    active: env('VICTORIA_ACTIVE', 'false') === 'true',
    victoriaEndpoint: process.env.VICTORIA_ENDPOINT,
    auth: {
      username: process.env.VICTORIA_USERNAME,
      password: process.env.VICTORIA_PASSWORD,
    },
    metricEnvironmentTag: env('METRIC_ENVIRONMENT_TAG', 'chain=unknown'),
  },
}

export const config = {
  // Only frontend worker
  objectMappingArchiver: {
    url: env('OBJECT_MAPPING_ARCHIVER_URL'),
    step: Number(env('OBJECT_MAPPING_ARCHIVER_STEP', '1000')),
  },
  // Currently only Frontend API but might be required in the Download API once we require users to pay
  authService: {
    url: env('AUTH_SERVICE_URL', 'http://localhost:3030'),
    token: env('AUTH_SERVICE_API_KEY'),
  },
  params: {
    maxConcurrentUploads: Number(env('MAX_CONCURRENT_UPLOADS', '40')),
    maxUploadNodesPerBatch: Number(env('MAX_UPLOAD_NODES_PER_BATCH', '20')),
    maxAnonymousDownloadSize: Number(
      env('MAX_ANONYMOUS_DOWNLOAD_SIZE', HUNDRED_MB.toString()),
    ),
    optionalAuth: env('OPTIONAL_AUTH', 'false') === 'true',
    defaultSubscription: {
      granularity: env('DEFAULT_SUBSCRIPTION_GRANULARITY', 'monthly'),
      uploadLimit: Number(
        env('DEFAULT_SUBSCRIPTION_UPLOAD_LIMIT', HUNDRED_MB.toString()),
      ),
      downloadLimit: Number(
        env('DEFAULT_SUBSCRIPTION_DOWNLOAD_LIMIT', FIVE_GB.toString()),
      ),
    },
    forbiddenExtensions: env('FORBIDDEN_EXTENSIONS', '').split(','),
  },
  // Only frontend worker
  services: {
    taskManager: {
      active:
        (optionalBoolEnvironmentVariable('TASK_MANAGER_ACTIVE') ||
          optionalBoolEnvironmentVariable('ALL_SERVICES_ACTIVE')) &&
        !optionalBoolEnvironmentVariable('TASK_MANAGER_DISABLED'),
      maxRetries: Number(env('TASK_MANAGER_MAX_RETRIES', '3')),
    },
    objectMappingArchiver: {
      active:
        (optionalBoolEnvironmentVariable('OBJECT_MAPPING_ARCHIVER_ACTIVE') ||
          optionalBoolEnvironmentVariable('ALL_SERVICES_ACTIVE')) &&
        !optionalBoolEnvironmentVariable('OBJECT_MAPPING_ARCHIVER_DISABLED'),
    },
  },
}
