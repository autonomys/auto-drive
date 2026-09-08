import { describe, it, expect } from '@jest/globals'
import type { Response } from 'express'
import type { ByteRange, DownloadMetadata } from '@autonomys/file-server'
import { applyVerbatimBodyHeaders } from '../../../src/app/controllers/s3/s3.js'

// The S3 read path always ships the STORED bytes: the ETag is the MD5 of those
// bytes and metadata.size counts them. For an internally-compressed object
// (x-amz-meta-compression) the shared download helper instead describes a body
// it would have re-encoded for a browser — `Content-Encoding: deflate`, no
// Content-Length, `Accept-Ranges: none`, and a range answered 200 with no
// Content-Range. applyVerbatimBodyHeaders puts the description back in step with
// the bytes actually sent.

/** Minimal Response stand-in recording what the helper wrote. */
const stubRes = () => {
  const headers = new Map<string, string>()
  let statusCode = 200
  const res = {
    setHeader: (name: string, value: string) => {
      headers.set(name.toLowerCase(), value)
      return res
    },
    removeHeader: (name: string) => {
      headers.delete(name.toLowerCase())
    },
    status: (code: number) => {
      statusCode = code
      return res
    },
  }
  return {
    res: res as unknown as Response,
    get: (name: string) => headers.get(name.toLowerCase()),
    has: (name: string) => headers.has(name.toLowerCase()),
    get statusCode() {
      return statusCode
    },
  }
}

/** What handleDownloadResponseHeaders leaves behind on a compressed object. */
const seedCompressedBranch = (h: ReturnType<typeof stubRes>) => {
  h.res.setHeader('Content-Encoding', 'deflate')
  h.res.setHeader('Accept-Ranges', 'none')
}

const metadata = (over: Partial<DownloadMetadata> = {}): DownloadMetadata => ({
  name: 'blob.bin',
  type: 'file',
  mimeType: 'application/octet-stream',
  size: BigInt(70),
  isEncrypted: false,
  isCompressed: true,
  ...over,
})

describe('applyVerbatimBodyHeaders', () => {
  it('drops the synthesised Content-Encoding and describes the stored size', () => {
    const h = stubRes()
    seedCompressedBranch(h)

    applyVerbatimBodyHeaders(h.res, metadata(), undefined)

    // The body is never re-encoded, so no transfer encoding is ours to claim —
    // any hop that honoured `deflate` would inflate the body and break the ETag.
    expect(h.has('Content-Encoding')).toBe(false)
    expect(h.get('Content-Length')).toBe('70')
    expect(h.get('Accept-Ranges')).toBe('bytes')
    expect(h.statusCode).toBe(200)
  })

  it('answers a range with 206 and a Content-Range over the stored bytes', () => {
    const h = stubRes()
    seedCompressedBranch(h)

    applyVerbatimBodyHeaders(h.res, metadata(), [0, 9] as ByteRange)

    // Without this the slice went out as a 200 with no Content-Range, so the
    // client read 10 bytes as the whole object.
    expect(h.statusCode).toBe(206)
    expect(h.get('Content-Range')).toBe('bytes 0-9/70')
    expect(h.get('Content-Length')).toBe('10')
    expect(h.get('Accept-Ranges')).toBe('bytes')
    expect(h.has('Content-Encoding')).toBe(false)
  })

  it('treats an open-ended range as running to the last stored byte', () => {
    const h = stubRes()
    seedCompressedBranch(h)

    applyVerbatimBodyHeaders(h.res, metadata(), [10, undefined] as ByteRange)

    expect(h.statusCode).toBe(206)
    expect(h.get('Content-Range')).toBe('bytes 10-69/70')
    expect(h.get('Content-Length')).toBe('60')
  })

  it('refuses ranges when the stored size is unknown, but still drops the encoding', () => {
    const h = stubRes()
    seedCompressedBranch(h)

    applyVerbatimBodyHeaders(h.res, metadata({ size: undefined }), undefined)

    expect(h.has('Content-Encoding')).toBe(false)
    expect(h.get('Accept-Ranges')).toBe('none')
    // No size to advertise: rely on chunked encoding rather than guess a length.
    expect(h.has('Content-Length')).toBe(false)
  })

  it('leaves an uncompressed object alone — the shared helper already got it right', () => {
    const h = stubRes()
    // A client-supplied Content-Encoding on a non-compressed object: opaque
    // metadata that must survive untouched.
    h.res.setHeader('Content-Encoding', 'gzip')
    h.res.setHeader('Accept-Ranges', 'bytes')
    h.res.setHeader('Content-Length', '70')

    applyVerbatimBodyHeaders(h.res, metadata({ isCompressed: false }), [
      0, 9,
    ] as ByteRange)

    expect(h.get('Content-Encoding')).toBe('gzip')
    expect(h.get('Content-Length')).toBe('70')
    expect(h.statusCode).toBe(200)
  })

  it('leaves a folder (zip) response alone', () => {
    const h = stubRes()
    seedCompressedBranch(h)

    applyVerbatimBodyHeaders(h.res, metadata({ type: 'folder' }), undefined)

    expect(h.get('Content-Encoding')).toBe('deflate')
    expect(h.get('Accept-Ranges')).toBe('none')
  })
})
