import { describe, it, expect } from '@jest/globals'
import { parseCoingeckoResponse } from '../../../src/infrastructure/services/priceOracle/coingecko.js'

describe('priceOracle/coingecko — response parser', () => {
  it('parses a live-shaped response into a scaled bigint + asOfMs', () => {
    // Captured verbatim from the live CoinGecko simple-price endpoint.
    const body = {
      'autonomys-network': { usd: 0.00639777, last_updated_at: 1783528850 },
    }
    const quote = parseCoingeckoResponse(body)
    expect(quote.usdPerAi3).toBe(6_397_770_000_000_000n)
    expect(quote.asOfMs).toBe(1783528850 * 1000)
  })

  it('handles a response without last_updated_at', () => {
    const quote = parseCoingeckoResponse({
      'autonomys-network': { usd: 0.0062 },
    })
    expect(quote.usdPerAi3).toBe(6_200_000_000_000_000n)
    expect(quote.asOfMs).toBeUndefined()
  })

  it('throws on a malformed, non-positive, or non-finite response', () => {
    expect(() => parseCoingeckoResponse({})).toThrow()
    expect(() =>
      parseCoingeckoResponse({ 'autonomys-network': { usd: 'oops' } }),
    ).toThrow()
    expect(() =>
      parseCoingeckoResponse({ 'autonomys-network': { usd: -1 } }),
    ).toThrow()
    expect(() =>
      parseCoingeckoResponse({ 'autonomys-network': { usd: Infinity } }),
    ).toThrow()
  })
})
