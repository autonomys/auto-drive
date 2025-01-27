import { env } from './utils/misc.js'

const DEFAULT_MAX_CACHE_SIZE = BigInt(10 * 1024 ** 3)

const DEFAULT_CACHE_MAX_SIZE = 10 * 1024 ** 3 // 10GB
const DEFAULT_CACHE_TTL = 1000000 // 1000000 seconds

export const config = {
  logLevel: env('LOG_LEVEL', 'info'),
  postgres: {
    url: env('DATABASE_URL'),
  },
  port: Number(env('PORT', '3000')),
  requestSizeLimit: env('REQUEST_SIZE_LIMIT', '200mb'),
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
  rpcEndpoint: env('RPC_ENDPOINT', 'ws://localhost:9944'),
  memoryDownloadCache: {
    maxCacheSize: Number(
      env('MEMORY_DOWNLOAD_CACHE_MAX_SIZE', DEFAULT_MAX_CACHE_SIZE.toString()),
    ),
  },
  objectMappingArchiverUrl: env('OBJECT_MAPPING_ARCHIVER_URL'),
  privateKeysPath: env('PRIVATE_KEYS_PATH', '//Alice'),
  filesGateway: env('FILES_GATEWAY_URL'),
  filesGatewayToken: env('FILES_GATEWAY_TOKEN'),
  authService: {
    url: env('AUTH_SERVICE_URL', 'http://localhost:3030'),
    token: env('AUTH_SERVICE_API_KEY'),
  },
  cacheDir: env('CACHE_DIR', './.cache'),
  cacheMaxSize: Number(
    env('CACHE_MAX_SIZE', DEFAULT_CACHE_MAX_SIZE.toString()),
  ),
  cacheTtl: Number(env('CACHE_TTL', DEFAULT_CACHE_TTL.toString())),
}
