import { describe, it, expect } from '@jest/globals'
import type { Request } from 'express'
import {
  parseS3Range,
  resolveSuffixRange,
} from '../../../src/app/controllers/s3/s3.js'

// S3 reads parse their own Range header. The shared getByteRange splits on the
// first '-' and runs Number() over both halves with no NaN guard, which turns
// two real client shapes into wrong answers rather than errors: a multi-range
// header yields a NaN end (advertised as `bytes 0-NaN/70` with a NaN length),
// and a suffix range `bytes=-500` — the LAST 500 bytes — yields [0, 500], the
// FIRST 501. Parquet, ORC, ZIP and media clients read footers that way, so the
// second is silent, plausible, wrong data.

const reqWith = (range?: string) =>
  ({ headers: range === undefined ? {} : { range } }) as unknown as Request

describe('parseS3Range', () => {
  it('parses a closed range', () => {
    expect(parseS3Range(reqWith('bytes=0-9'))).toEqual({
      kind: 'offset',
      start: 0,
      end: 9,
    })
  })

  it('parses an open-ended range', () => {
    expect(parseS3Range(reqWith('bytes=100-'))).toEqual({
      kind: 'offset',
      start: 100,
      end: undefined,
    })
  })

  it('parses a suffix range as a suffix, not an offset', () => {
    // getByteRange read this as [0, 500] and served the head of the file.
    expect(parseS3Range(reqWith('bytes=-500'))).toEqual({
      kind: 'suffix',
      length: 500,
    })
  })

  it('still accepts the space separator the previous parser allowed', () => {
    // It read the header by slicing six characters, so a space worked. Not valid
    // per RFC 7233, but tightening it would change behaviour rather than fix
    // anything.
    expect(parseS3Range(reqWith('bytes 0-9'))).toEqual({
      kind: 'offset',
      start: 0,
      end: 9,
    })
  })

  it('is case- and whitespace-insensitive on the unit', () => {
    expect(parseS3Range(reqWith(' BYTES=0-9 '))).toEqual({
      kind: 'offset',
      start: 0,
      end: 9,
    })
  })

  it('ignores a header that is absent or not a byte range', () => {
    expect(parseS3Range(reqWith())).toBeUndefined()
    expect(parseS3Range(reqWith('items=0-9'))).toBeUndefined()
    expect(parseS3Range(reqWith('bytes=-'))).toBeUndefined()
    expect(parseS3Range(reqWith(''))).toBeUndefined()
  })

  it.each(['bytes=0-9, 20-29', 'bytes=0-abc', 'bytes=abc-9', 'bytes=9-0'])(
    'ignores %s rather than deriving a range from it',
    (header) => {
      // RFC 7233: a Range that cannot be parsed is ignored (the whole object is
      // served). S3 does the same with a multi-range request. Deriving a partial
      // range from it is how `Content-Length: NaN` was reached.
      expect(parseS3Range(reqWith(header))).toBeUndefined()
    },
  )
})

describe('resolveSuffixRange', () => {
  it('resolves to the last N bytes', () => {
    expect(resolveSuffixRange(500, BigInt(10_000))).toEqual([9500, 9999])
  })

  it('clamps a suffix longer than the object to the whole object', () => {
    expect(resolveSuffixRange(500, BigInt(70))).toEqual([0, 69])
  })

  it('refuses a zero-length suffix and any suffix of an empty object', () => {
    expect(resolveSuffixRange(0, BigInt(70))).toBe('unsatisfiable')
    expect(resolveSuffixRange(10, BigInt(0))).toBe('unsatisfiable')
  })
})
