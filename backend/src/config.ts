import { env } from './utils/misc.js'

const DEFAULT_CHUNK_SIZE = 10 * 1024 ** 2
const DEFAULT_MAX_CACHE_SIZE = BigInt(10 * 1024 ** 3)

export const config = {
  logLevel: env('LOG_LEVEL', 'info'),
  postgres: {
    url: env('DATABASE_URL'),
  },
  port: Number(env('PORT', '3000')),
  requestSizeLimit: env('REQUEST_SIZE_LIMIT', '200mb'),
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
  rpcEndpoint: env('RPC_ENDPOINT', 'ws://localhost:9944'),
  databaseDownloadCache: {
    chunkSize: Number(
      env('DATABASE_DOWNLOAD_CACHE_CHUNK_SIZE', DEFAULT_CHUNK_SIZE.toString()),
    ),
    maxCacheSize: BigInt(
      env(
        'DATABASE_DOWNLOAD_CACHE_MAX_SIZE',
        DEFAULT_MAX_CACHE_SIZE.toString(),
      ),
    ),
  },
  memoryDownloadCache: {
    maxCacheSize: Number(
      env('MEMORY_DOWNLOAD_CACHE_MAX_SIZE', DEFAULT_MAX_CACHE_SIZE.toString()),
    ),
  },
  objectMappingArchiverUrl: env('OBJECT_MAPPING_ARCHIVER_URL'),
  privateKeysPath: env('PRIVATE_KEYS_PATH', '//Alice'),
  filesGateway: env('FILES_GATEWAY_URL'),
}
