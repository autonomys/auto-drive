import { describe, it, expect } from '@jest/globals'
import { parseMaxKeys } from '../../../src/app/controllers/s3/utils.js'

describe('parseMaxKeys', () => {
  it('defaults to 1000 when max-keys is omitted or empty', () => {
    expect(parseMaxKeys(undefined)).toBe(1000)
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

  it('accepts a leading plus sign and leading zeros', () => {
    expect(parseMaxKeys('+5')).toBe(5)
    expect(parseMaxKeys('0005')).toBe(5)
  })

  it('caps values above 1000 at 1000', () => {
    expect(parseMaxKeys('2000')).toBe(1000)
    expect(parseMaxKeys('2147483647')).toBe(1000)
  })

  it('uses the first value of a repeated max-keys parameter', () => {
    expect(parseMaxKeys(['5', '10'])).toBe(5)
    expect(parseMaxKeys(['abc', '10'])).toBeNull()
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

  it('rejects a nested query object', () => {
    expect(parseMaxKeys({ a: '1' })).toBeNull()
  })
})
