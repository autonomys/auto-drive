import { z } from 'zod'
import { parseDecimalToScaledBigint } from './quote.js'
import type { RawQuote } from './types.js'

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

// Fetch the current AI3/USD quote from CoinGecko. `signal` aborts the request
// when the oracle's fetch timeout fires.
export const fetchCoingeckoQuote = async (
  signal?: AbortSignal,
): Promise<RawQuote> => {
  const response = await fetch(COINGECKO_URL, {
    headers: { accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    throw new Error(`CoinGecko responded with HTTP ${response.status}`)
  }
  return parseCoingeckoResponse(await response.json())
}
