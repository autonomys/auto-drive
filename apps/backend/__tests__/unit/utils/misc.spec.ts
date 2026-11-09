import { describe, it, expect, afterEach } from '@jest/globals'
import {
  positiveIntEnv,
  positiveBigIntEnv,
} from '../../../src/shared/utils/misc.js'

const KEY = 'TEST_POSITIVE_INT_ENV'
const BIGINT_KEY = 'TEST_POSITIVE_BIGINT_ENV'

describe('positiveIntEnv', () => {
  afterEach(() => {
    delete process.env[KEY]
  })

  it('returns the fallback when the variable is unset', () => {
    expect(positiveIntEnv(KEY, 25)).toBe(25)
  })

  it('parses a valid positive integer', () => {
    process.env[KEY] = '50'
    expect(positiveIntEnv(KEY, 25)).toBe(50)
  })

  it('floors a decimal value', () => {
    process.env[KEY] = '12.9'
    expect(positiveIntEnv(KEY, 25)).toBe(12)
  })

  it('falls back on a non-numeric value (NaN guard)', () => {
    process.env[KEY] = 'not-a-number'
    expect(positiveIntEnv(KEY, 25)).toBe(25)
  })

  it('falls back on zero', () => {
    process.env[KEY] = '0'
    expect(positiveIntEnv(KEY, 25)).toBe(25)
  })

  it('falls back on a negative value', () => {
    process.env[KEY] = '-5'
    expect(positiveIntEnv(KEY, 25)).toBe(25)
  })
})

describe('positiveBigIntEnv', () => {
  afterEach(() => {
    delete process.env[BIGINT_KEY]
  })

  it('returns the fallback when the variable is unset', () => {
    expect(positiveBigIntEnv(BIGINT_KEY, 100n)).toBe(100n)
  })

  it('parses a valid positive bigint integer string', () => {
    process.env[BIGINT_KEY] = '1000000000000000000'
    expect(positiveBigIntEnv(BIGINT_KEY, 100n)).toBe(1000000000000000000n)
  })

  it('safely parses scientific notation like 1e18 without throwing', () => {
    process.env[BIGINT_KEY] = '1e18'
    expect(positiveBigIntEnv(BIGINT_KEY, 100n)).toBe(1000000000000000000n)
  })

  it('safely handles decimals like 1.5 without throwing', () => {
    process.env[BIGINT_KEY] = '1.5'
    expect(positiveBigIntEnv(BIGINT_KEY, 100n)).toBe(1n)
  })

  it('falls back on non-numeric or invalid string without throwing', () => {
    process.env[BIGINT_KEY] = 'invalid-bigint-literal'
    expect(positiveBigIntEnv(BIGINT_KEY, 100n)).toBe(100n)
  })

  it('falls back on zero', () => {
    process.env[BIGINT_KEY] = '0'
    expect(positiveBigIntEnv(BIGINT_KEY, 100n)).toBe(100n)
  })

  it('falls back on negative values', () => {
    process.env[BIGINT_KEY] = '-500'
    expect(positiveBigIntEnv(BIGINT_KEY, 100n)).toBe(100n)
  })
})
