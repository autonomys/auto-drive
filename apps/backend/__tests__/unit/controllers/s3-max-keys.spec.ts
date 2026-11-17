import { describe, it, expect } from '@jest/globals'
import { parseMaxKeys } from '../../../src/app/controllers/s3/utils.js'

describe('parseMaxKeys', () => {
  it('defaults to 1000 when max-keys is omitted', () => {
    expect(parseMaxKeys(undefined)).toBe(1000)
  })

  it('accepts 0 as a listing that returns nothing', () => {
    expect(parseMaxKeys('0')).toBe(0)
  })

  it('passes values up to 1000 through unchanged', () => {
    expect(parseMaxKeys('1')).toBe(1)
    expect(parseMaxKeys('5')).toBe(5)
    expect(parseMaxKeys('1000')).toBe(1000)
  })

  it('caps values above 1000 at 1000', () => {
    expect(parseMaxKeys('2000')).toBe(1000)
    expect(parseMaxKeys('2147483647')).toBe(1000)
  })

  it('rejects negative values', () => {
    expect(parseMaxKeys('-1')).toBeNull()
  })

  it('rejects values S3 does not accept as an integer', () => {
    expect(parseMaxKeys('')).toBeNull()
    expect(parseMaxKeys('abc')).toBeNull()
    expect(parseMaxKeys('1.5')).toBeNull()
    expect(parseMaxKeys('5abc')).toBeNull()
    expect(parseMaxKeys(' 5')).toBeNull()
    expect(parseMaxKeys('2147483648')).toBeNull()
  })

  it('rejects a repeated max-keys parameter', () => {
    expect(parseMaxKeys(['5', '10'])).toBeNull()
  })
})
