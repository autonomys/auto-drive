import { describe, it, expect, afterEach } from '@jest/globals'
import { positiveIntEnv } from '../../../src/shared/utils/misc.js'

const KEY = 'TEST_POSITIVE_INT_ENV'

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
