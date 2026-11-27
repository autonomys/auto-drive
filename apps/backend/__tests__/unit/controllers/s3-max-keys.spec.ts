import { describe, it, expect } from '@jest/globals'
import { Request } from 'express'
import {
  decodeContinuationToken,
  encodeContinuationToken,
  listingQuery,
  parseMaxKeys,
} from '../../../src/app/controllers/s3/utils.js'

describe('parseMaxKeys', () => {
  it('defaults to 1000 when max-keys is omitted or empty', () => {
    expect(parseMaxKeys(null)).toBe(1000)
    expect(parseMaxKeys('')).toBe(1000)
  })

  it('accepts 0 as a listing that returns nothing', () => {
    expect(parseMaxKeys('0')).toBe(0)
    expect(parseMaxKeys('-0')).toBe(0)
  })

  it('passes values up to 1000 through unchanged', () => {
    expect(parseMaxKeys('1')).toBe(1)
    expect(parseMaxKeys('5')).toBe(5)
    expect(parseMaxKeys('1000')).toBe(1000)
  })

  // '+5' arrives only when sent as %2B5; an unencoded '+' decodes to a space.
  it('accepts a leading plus sign and leading zeros', () => {
    expect(parseMaxKeys('+5')).toBe(5)
    expect(parseMaxKeys('0005')).toBe(5)
  })

  it('caps values above 1000 at 1000', () => {
    expect(parseMaxKeys('2000')).toBe(1000)
    expect(parseMaxKeys('2147483647')).toBe(1000)
  })

  it('rejects negative values', () => {
    expect(parseMaxKeys('-1')).toBeNull()
  })

  it('rejects values S3 does not accept as an integer', () => {
    expect(parseMaxKeys('abc')).toBeNull()
    expect(parseMaxKeys('1.5')).toBeNull()
    expect(parseMaxKeys('5abc')).toBeNull()
    expect(parseMaxKeys(' 5')).toBeNull()
    expect(parseMaxKeys('2147483648')).toBeNull()
  })
})

describe('listingQuery', () => {
  const query = (url: string) => listingQuery({ originalUrl: url } as Request)

  it('reads a repeated parameter by its first value', () => {
    expect(query('/b?prefix=a&prefix=b').get('prefix')).toBe('a')
    expect(query('/b?max-keys=abc&max-keys=10').get('max-keys')).toBe('abc')
  })

  it('treats a bracketed name as a different parameter', () => {
    expect(query('/b?max-keys[a]=1').get('max-keys')).toBeNull()
    expect(query('/b?prefix[]=a').get('prefix')).toBeNull()
  })

  it('decodes an unencoded + as a space and %2B as a plus', () => {
    expect(query('/b?max-keys=+5').get('max-keys')).toBe(' 5')
    expect(query('/b?max-keys=%2B5').get('max-keys')).toBe('+5')
  })

  it('returns no parameters for a URL without a query string', () => {
    expect(query('/b').get('prefix')).toBeNull()
  })
})

describe('continuation tokens', () => {
  it('round-trips keys XML cannot carry, as XML- and URL-safe text', () => {
    for (const key of ['a.txt', 'big/\uFFFF', 'dir/\x01', '世界/😀']) {
      const token = encodeContinuationToken(key)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(decodeContinuationToken(token)).toBe(key)
    }
  })

  it('rejects a token it did not issue', () => {
    expect(decodeContinuationToken('a/b.c')).toBeNull()
    expect(decodeContinuationToken('YQ==')).toBeNull()
    // Valid base64url, but the bytes are not UTF-8.
    expect(decodeContinuationToken('_w')).toBeNull()
  })

  it('rejects a token naming a key that holds NUL', () => {
    expect(decodeContinuationToken('AA')).toBeNull()
    expect(decodeContinuationToken(encodeContinuationToken('a\0b'))).toBeNull()
  })
})
