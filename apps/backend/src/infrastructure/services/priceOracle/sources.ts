import { z } from 'zod'
import { createLogger } from '../../drivers/logger.js'
import { parseDecimalToScaledBigint } from './aggregate.js'
import type { PriceSourceAdapter, RawQuote } from './types.js'

const logger = createLogger('PriceOracle:sources')

// --- CoinGecko -------------------------------------------------------------
// Public simple-price endpoint (no key required). `autonomys-network` is AI3's
// CoinGecko id; CoinGecko is itself a volume-weighted aggregate across venues.
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price' +
  '?ids=autonomys-network&vs_currencies=usd&include_last_updated_at=true'

const coingeckoResponseSchema = z.object({
  'autonomys-network': z.object({
    usd: z.number().positive().finite(),
    last_updated_at: z.number().optional(),
  }),
})

// Exported for direct unit testing against captured fixtures (no HTTP).
export const parseCoingeckoResponse = (body: unknown): RawQuote => {
  const data = coingeckoResponseSchema.parse(body)
  const quote = data['autonomys-network']
  return {
    // For AI3-range numbers `toString()` yields a plain decimal (no exponential
    // notation), which parseDecimalToScaledBigint scales exactly.
    usdPerAi3: parseDecimalToScaledBigint(quote.usd.toString()),
    asOfMs:
      quote.last_updated_at !== undefined
        ? quote.last_updated_at * 1000
        : undefined,
  }
}

const fetchCoingecko = async (signal?: AbortSignal): Promise<RawQuote> => {
  const response = await fetch(COINGECKO_URL, {
    headers: { accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    throw new Error(`CoinGecko responded with HTTP ${response.status}`)
  }
  return parseCoingeckoResponse(await response.json())
}

export const coingeckoSource: PriceSourceAdapter = {
  name: 'coingecko',
  fetch: fetchCoingecko,
}

// Available sources keyed by the name used in ORACLE_SOURCES. Only CoinGecko is
// implemented today; the aggregation machinery generalises to more when added.
export const sourceRegistry: Record<string, PriceSourceAdapter> = {
  [coingeckoSource.name]: coingeckoSource,
}

// Map configured source names to adapters: de-duplicate (so the same source
// cannot satisfy minSources twice) and warn on + skip unknown names.
export const resolveSources = (names: string[]): PriceSourceAdapter[] => {
  const seen = new Set<string>()
  return names.flatMap((name) => {
    if (seen.has(name)) {
      return []
    }
    seen.add(name)
    const adapter = sourceRegistry[name]
    if (!adapter) {
      logger.warn(`Unknown price oracle source "${name}"; ignoring`)
      return []
    }
    return [adapter]
  })
}
