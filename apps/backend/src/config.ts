import 'dotenv/config'
import { SubscriptionGranularity } from '@auto-drive/models'
import { optionalBoolEnvironmentVariable, env } from './shared/utils/misc.js'
import { getAddress } from 'viem'

const DEFAULT_MAX_CACHE_SIZE = BigInt(10 * 1024 ** 3)

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
      env('MEMORY_DOWNLOAD_CACHE_MAX_SIZE', DEFAULT_MAX_CACHE_SIZE.toString()),
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
    prefetch: Number(env('RABBITMQ_PREFETCH', '10')),
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
    confirmations: Number(env('EVM_CHAIN_CONFIRMATIONS', '12')),
    checkInterval: Number(env('EVM_CHAIN_CHECK_INTERVAL', '30_000')),
  },
  params: {
    maxConcurrentUploads: Number(env('MAX_CONCURRENT_UPLOADS', '40')),
    maxAnonymousDownloadSize: Number(
      env('MAX_ANONYMOUS_DOWNLOAD_SIZE', ONE_HUNDRED_MiB.toString()),
    ),
    optionalAuth: env('OPTIONAL_AUTH', 'false') === 'true',
    defaultSubscription: {
      granularity: env(
        'DEFAULT_SUBSCRIPTION_GRANULARITY',
        SubscriptionGranularity.OneOff,
      ),
      uploadLimit: Number(
        env('DEFAULT_SUBSCRIPTION_UPLOAD_LIMIT', ONE_HUNDRED_MiB.toString()),
      ),
      downloadLimit: Number(
        env('DEFAULT_SUBSCRIPTION_DOWNLOAD_LIMIT', FIVE_GiB.toString()),
      ),
    },
    web3DefaultSubscription: {
      uploadLimit: Number(
        env('WEB3_DEFAULT_SUBSCRIPTION_UPLOAD_LIMIT', ONE_MiB.toString()),
      ),
      downloadLimit: Number(
        env(
          'WEB3_DEFAULT_SUBSCRIPTION_DOWNLOAD_LIMIT',
          ONE_HUNDRED_MiB.toString(),
        ),
      ),
    },
    forbiddenExtensions: env('FORBIDDEN_EXTENSIONS', '').split(','),
  },
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
