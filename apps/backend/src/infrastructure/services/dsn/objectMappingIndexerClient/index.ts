import { ObjectMappingIndexerRPCApi } from '@auto-files/rpc-apis'
import { config } from '../../../../config.js'
import { createLogger } from '../../../drivers/logger.js'

const logger = createLogger('dsn:objectMappingIndexerClient')

const getHttpUrl = (url: string) => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  return url.replace(/^ws(s)?:\/\//, 'http$1://')
}

const httpClient = ObjectMappingIndexerRPCApi.createHttpClient(
  getHttpUrl(config.objectMappingArchiver.url),
)

// If more than this many consecutive individual lookups fail,
// assume the indexer is down and stop wasting round-trips.
const MAX_CONSECUTIVE_FAILURES = 10

/**
 * Batch-queries the indexer for object mappings by hash.
 *
 * The indexer's get_object_mappings throws if ANY hash in the batch is missing.
 * When that happens, we fall back to querying hashes individually so we can
 * still resolve the ones the indexer does have. A circuit breaker aborts if
 * the indexer appears to be unreachable.
 */
const getObjectMappings = async (
  hashes: string[],
): Promise<Array<[string, number, number]>> => {
  try {
    return await httpClient.get_object_mappings({ hashes })
  } catch {
    // Batch failed — likely some hashes missing from indexer.
    // Fall back to individual queries to salvage what we can.
    logger.debug(
      'Batch lookup failed for %d hashes, falling back to individual queries',
      hashes.length,
    )
    const results: Array<[string, number, number]> = []
    let consecutiveFailures = 0

    for (const hash of hashes) {
      try {
        const [mapping] = await httpClient.get_object_mappings({
          hashes: [hash],
        })
        if (mapping) {
          results.push(mapping)
        }
        consecutiveFailures = 0
      } catch {
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.warn(
            'Aborting individual lookups after %d consecutive failures (%d/%d resolved so far)',
            MAX_CONSECUTIVE_FAILURES,
            results.length,
            hashes.length,
          )
          break
        }
      }
    }
    return results
  }
}

export const objectMappingIndexerClient = {
  getObjectMappings,
}
