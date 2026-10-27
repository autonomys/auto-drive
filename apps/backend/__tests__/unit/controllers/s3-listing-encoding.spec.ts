import { describe, it, expect } from '@jest/globals'
import {
  encodeS3Key,
  hasXmlIllegalChars,
  planListingEncoding,
} from '../../../src/app/controllers/s3/utils.js'

describe('hasXmlIllegalChars', () => {
  it('returns false for ordinary keys', () => {
    expect(hasXmlIllegalChars('dir/file.txt')).toBe(false)
    expect(hasXmlIllegalChars('hello world (1).txt')).toBe(false)
    expect(hasXmlIllegalChars('Hello, 世界/ " \' @ < > & ? + ≠')).toBe(false)
  })

  it('treats TAB, LF and CR as legal (XML permits them)', () => {
    expect(hasXmlIllegalChars('a\tb')).toBe(false)
    expect(hasXmlIllegalChars('a\nb')).toBe(false)
    expect(hasXmlIllegalChars('a\rb')).toBe(false)
  })

  it('detects control characters XML 1.0 cannot represent', () => {
    expect(hasXmlIllegalChars('recon-ctrl-\x01\x02-test.txt')).toBe(true)
    expect(hasXmlIllegalChars('\x00')).toBe(true)
    expect(hasXmlIllegalChars('\x0B')).toBe(true)
    expect(hasXmlIllegalChars('\x0C')).toBe(true)
    expect(hasXmlIllegalChars('\x1F')).toBe(true)
  })
})

describe('encodeS3Key', () => {
  it('percent-encodes control characters', () => {
    expect(encodeS3Key('a\x01b')).toBe('a%01b')
  })

  it('encodes spaces as %20 (never +) and encodes a literal +', () => {
    expect(encodeS3Key('a b')).toBe('a%20b')
    expect(encodeS3Key('a+b')).toBe('a%2Bb')
  })

  it('encodes reserved characters so decoding round-trips', () => {
    expect(encodeS3Key('dir/file')).toBe('dir%2Ffile')
    expect(encodeS3Key('a%b')).toBe('a%25b')
  })

  it('round-trips back to the original via decodeURIComponent', () => {
    const key = 'dir/weird key+\x01\x02-世界.txt'
    expect(decodeURIComponent(encodeS3Key(key))).toBe(key)
  })

  it('leaves the unreserved set untouched', () => {
    expect(encodeS3Key('abcABC123-_.!~*\'()')).toBe('abcABC123-_.!~*\'()')
  })
})

describe('planListingEncoding', () => {
  const cleanKeys = ['dir/a.txt', 'dir/b.txt', 'sub/']
  const dirtyKeys = ['dir/a.txt', 'recon-ctrl-\x01\x02-test.txt']

  it('renders a clean page unchanged when the client does not opt in', () => {
    expect(planListingEncoding(cleanKeys, null)).toBe('plain')
  })

  it('encodes when the client opts in, even for a clean page', () => {
    expect(planListingEncoding(cleanKeys, 'url')).toBe('encode')
  })

  it('encodes an affected page when the client opts in', () => {
    expect(planListingEncoding(dirtyKeys, 'url')).toBe('encode')
  })

  it('rejects an affected page when the client did not opt in', () => {
    expect(planListingEncoding(dirtyKeys, null)).toBe('reject')
  })

  it('treats an illegal CommonPrefix the same as an illegal key', () => {
    expect(planListingEncoding(['ok/', 'bad\x07/'], null)).toBe('reject')
    expect(planListingEncoding(['ok/', 'bad\x07/'], 'url')).toBe('encode')
  })
})
