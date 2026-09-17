import { describe, it, expect } from '@jest/globals'
import { optionalTrimmedEnv, rawListEnv } from '../../src/config.js'
import { readFileSync } from 'fs'

// Environment values that arrive blank, which is what every `.env.sample` key
// looks like until an operator fills it in.
describe('optionalTrimmedEnv', () => {
  it('treats an empty value as unset', () => {
    // The distinction dotenv erases: `KEY=` parses to '' and not undefined. A
    // consumer testing `!== undefined` would treat a blank key as configured and
    // hand the empty string to a parser — which, for the USDC resume threshold,
    // meant the gates job refused to start and USDC stayed permanently closed on
    // any deployment configured from the sample file.
    expect(optionalTrimmedEnv('')).toBeUndefined()
    expect(optionalTrimmedEnv(undefined)).toBeUndefined()
  })

  it('treats a whitespace-only value as unset', () => {
    // These values arrive from mounted secrets and hand-edited files as often as
    // from a shell, and both routinely carry a trailing newline.
    expect(optionalTrimmedEnv('   ')).toBeUndefined()
    expect(optionalTrimmedEnv('\n')).toBeUndefined()
  })

  it('trims a real value rather than discarding it', () => {
    expect(optionalTrimmedEnv(' 1500 \n')).toBe('1500')
  })

  it('keeps a value that means zero', () => {
    // '0' is falsy as a string only in the sense `env()` gets wrong; a threshold
    // of zero is a legitimate (if drastic) configuration and must survive.
    expect(optionalTrimmedEnv('0')).toBe('0')
  })
})

describe('rawListEnv', () => {
  it('drops empties and whitespace without validating', () => {
    // Validation belongs where an unusable entry can close the gate rather than
    // shrink the sum — see treasuryAddresses.
    expect(rawListEnv(' 0xabc , ,0xdef ')).toEqual(['0xabc', '0xdef'])
    expect(rawListEnv('')).toEqual([])
    expect(rawListEnv(undefined)).toEqual([])
  })
})

describe('.env.sample', () => {
  it('ships the optional USDC keys blank, which is why the above matters', () => {
    // Pins the premise rather than the parser: if the sample ever stops shipping
    // these blank, the reasoning above is still correct but no longer load-bearing
    // — and if a NEW optional key is added blank, it needs the same treatment.
    const sample = readFileSync(
      new URL('../../.env.sample', import.meta.url),
      'utf-8',
    )
    expect(sample).toContain('USDC_TREASURY_RESUME_THRESHOLD=\n')
    expect(sample).toContain('USDC_TREASURY_ADDRESSES=\n')
  })
})
