import { describe, it, expect } from '@jest/globals'
import { createHash } from 'crypto'
import { multipartETag } from '@autonomys/file-server'
import {
  MalformedMultipartError,
  parseMultipartParts,
} from '../../../src/app/controllers/s3/s3.js'

// Two known per-part MD5s: md5("") and md5("a").
const M1 = 'd41d8cd98f00b204e9800998ecf8427e'
const M2 = '0cc175b9c0f1b6a831c399e269772661'

// The AWS composite ETag = md5( raw(M1) ++ raw(M2) ) + "-" + partCount.
const expectedComposite = `${createHash('md5')
  .update(Buffer.concat([Buffer.from(M1, 'hex'), Buffer.from(M2, 'hex')]))
  .digest('hex')}-2`

const buf = (s: string) => Buffer.from(s, 'utf-8')

// aws-cli / boto3: PartNumber before ETag, quotes emitted literally.
const botoBody = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Part><PartNumber>1</PartNumber><ETag>"${M1}"</ETag></Part><Part><PartNumber>2</PartNumber><ETag>"${M2}"</ETag></Part></CompleteMultipartUpload>`

// aws-sdk-go-v2 / rclone: ETag before PartNumber, quotes escaped as &#34;.
const goSdkBody = `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Part><ETag>&#34;${M1}&#34;</ETag><PartNumber>1</PartNumber></Part><Part><ETag>&#34;${M2}&#34;</ETag><PartNumber>2</PartNumber></Part></CompleteMultipartUpload>`

describe('parseMultipartParts', () => {
  it('parses the aws-cli (boto3) body', () => {
    expect(parseMultipartParts(buf(botoBody))).toEqual([
      { PartNumber: 1, ETag: `"${M1}"` },
      { PartNumber: 2, ETag: `"${M2}"` },
    ])
  })

  it('parses the aws-sdk-go-v2 (rclone) body, decoding &#34; to literal quotes', () => {
    const parts = parseMultipartParts(buf(goSdkBody))
    expect(parts).toEqual([
      { PartNumber: 1, ETag: `"${M1}"` },
      { PartNumber: 2, ETag: `"${M2}"` },
    ])
    // The bug was that &#34; survived and broke the hex decode.
    expect(parts.every((p) => !p.ETag.includes('&#34;'))).toBe(true)
  })

  it('yields identical parts for both SDK encodings', () => {
    expect(parseMultipartParts(buf(goSdkBody))).toEqual(
      parseMultipartParts(buf(botoBody)),
    )
  })

  it('produces the correct AWS composite ETag from the go-sdk body', () => {
    const parts = parseMultipartParts(buf(goSdkBody))
    const composite = multipartETag(parts.map((p) => p.ETag)).replace(/"/g, '')
    expect(composite).toBe(expectedComposite)
    // Regression guard: must not be the MD5-of-empty value the old parser stored.
    expect(composite.startsWith('d41d8cd98f00b204e9800998ecf8427e-')).toBe(false)
  })

  it('handles namespace-prefixed elements', () => {
    const nsBody = `<s3:CompleteMultipartUpload xmlns:s3="http://s3.amazonaws.com/doc/2006-03-01/"><s3:Part><s3:PartNumber>1</s3:PartNumber><s3:ETag>"${M1}"</s3:ETag></s3:Part></s3:CompleteMultipartUpload>`
    expect(parseMultipartParts(buf(nsBody))).toEqual([
      { PartNumber: 1, ETag: `"${M1}"` },
    ])
  })

  it('sorts parts by PartNumber', () => {
    const body = `<CompleteMultipartUpload><Part><PartNumber>2</PartNumber><ETag>"${M2}"</ETag></Part><Part><PartNumber>1</PartNumber><ETag>"${M1}"</ETag></Part></CompleteMultipartUpload>`
    expect(parseMultipartParts(buf(body)).map((p) => p.PartNumber)).toEqual([
      1, 2,
    ])
  })

  describe('rejects malformed bodies with MalformedMultipartError', () => {
    it('missing root element', () => {
      expect(() => parseMultipartParts(buf('<Other></Other>'))).toThrow(
        MalformedMultipartError,
      )
    })

    it('empty body', () => {
      expect(() => parseMultipartParts(buf(''))).toThrow(MalformedMultipartError)
    })

    it('no parts', () => {
      expect(() =>
        parseMultipartParts(
          buf('<CompleteMultipartUpload></CompleteMultipartUpload>'),
        ),
      ).toThrow(MalformedMultipartError)
    })

    it('part missing PartNumber', () => {
      expect(() =>
        parseMultipartParts(
          buf(
            `<CompleteMultipartUpload><Part><ETag>"${M1}"</ETag></Part></CompleteMultipartUpload>`,
          ),
        ),
      ).toThrow(MalformedMultipartError)
    })

    it('part with empty ETag', () => {
      expect(() =>
        parseMultipartParts(
          buf(
            '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag></ETag></Part></CompleteMultipartUpload>',
          ),
        ),
      ).toThrow(MalformedMultipartError)
    })

    it('part with non-integer PartNumber', () => {
      expect(() =>
        parseMultipartParts(
          buf(
            `<CompleteMultipartUpload><Part><PartNumber>1.5</PartNumber><ETag>"${M1}"</ETag></Part></CompleteMultipartUpload>`,
          ),
        ),
      ).toThrow(MalformedMultipartError)
    })
  })
})
