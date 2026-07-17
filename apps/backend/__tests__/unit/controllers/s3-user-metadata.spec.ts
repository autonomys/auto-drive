import { describe, it, expect } from '@jest/globals'
import { userMetadataByteSize } from '../../../src/app/controllers/s3/s3.js'

// S3 caps user-defined metadata (x-amz-meta-*) at 2 KB, measured as the sum of
// the UTF-8 byte lengths of every key and value; system headers don't count.
// userMetadataByteSize is that measurement (the 2048-byte reject lives in the
// write handlers and is exercised end-to-end in the s3-sdk integration suite).
describe('userMetadataByteSize (S3 2 KB user-metadata limit)', () => {
  it('is 0 when there is no user metadata', () => {
    expect(userMetadataByteSize(null)).toBe(0)
    expect(userMetadataByteSize(undefined)).toBe(0)
    // System headers are not user metadata and must not be counted.
    expect(
      userMetadataByteSize({
        contentType: 'text/csv',
        cacheControl: 'max-age=999',
      }),
    ).toBe(0)
  })

  it('sums the byte lengths of user-metadata keys and values only', () => {
    // 'author'(6) + 'alice'(5) + 'x'(1) + 'yz'(2) = 14; contentType excluded.
    expect(
      userMetadataByteSize({
        contentType: 'text/csv',
        userMetadata: { author: 'alice', x: 'yz' },
      }),
    ).toBe(14)
  })

  it('counts multi-byte UTF-8 by byte, not by character', () => {
    // 'k'(1) + '€'(3 bytes in UTF-8) = 4.
    expect(userMetadataByteSize({ userMetadata: { k: '€' } })).toBe(4)
  })
})
