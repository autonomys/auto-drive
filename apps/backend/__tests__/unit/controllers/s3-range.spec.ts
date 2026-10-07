import { describe, it, expect, jest, afterEach } from '@jest/globals'
import type { Request, Response } from 'express'
import { Readable } from 'stream'
import { err, ok } from 'neverthrow'
import {
  headObjectHandler,
  parseS3Range,
  rangeParams,
} from '../../../src/app/controllers/s3/s3.js'
import { S3UseCases } from '../../../src/core/s3/index.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { createMockUser } from '../../utils/mocks.js'
import { RangeNotSatisfiableError } from '../../../src/errors/index.js'

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

describe('rangeParams', () => {
  it('sends an offset range as Range', () => {
    expect(rangeParams({ kind: 'offset', start: 0, end: 9 })).toEqual({
      Range: [0, 9],
    })
  })

  it('keeps an open-ended range open for the use case to clamp', () => {
    expect(rangeParams({ kind: 'offset', start: 100 })).toEqual({
      Range: [100, undefined],
    })
  })

  it('sends a suffix as SuffixLength, never as a Range', () => {
    // The distinction is the whole point: a Range is absolute offsets, and a
    // suffix has none until the use case knows which cid it is reading.
    expect(rangeParams({ kind: 'suffix', length: 500 })).toEqual({
      SuffixLength: 500,
    })
  })

  it('sends nothing when there is no range', () => {
    expect(rangeParams(undefined)).toEqual({})
  })
})

// A suffix range used to be resolved by the controller: probe the key for its
// size, then read the key again with the offsets that size implied. Two lookups
// for one read is a torn read waiting to happen — a PutObject landing in between
// makes the second lookup a different object, so offsets sized for the old
// content get cut out of the new and shipped as a 206 with the new ETag beside
// them. Pinning the second read to the measured version fixed the tear but
// depended on every live mapping having an object_versions row, which a rolling
// deploy can break (old pods kept writing mappings after the backfill snapshot).
// Resolving inside the use case removes the second lookup instead: the cid it
// already settled on IS the identity, so the size measured and the bytes
// returned cannot belong to different objects.
describe('a suffix range is resolved by the use case, not a second read', () => {
  const VALID_AUTH =
    'AWS4-HMAC-SHA256 Credential=e046e71c8dc3459c8da189e62418203a/20260821/us-west-2/s3/aws4_request, SignedHeaders=host, Signature=0'

  /** Minimal Response stand-in that records what the handler wrote. */
  const stubRes = () => {
    const headers = new Map<string, string>()
    const state: { status?: number; body?: string } = {}
    const res = {
      set: (name: string, value: string) => {
        headers.set(name.toLowerCase(), value)
        return res
      },
      setHeader: (name: string, value: string) => {
        headers.set(name.toLowerCase(), value)
        return res
      },
      removeHeader: (name: string) => {
        headers.delete(name.toLowerCase())
      },
      status: (code: number) => {
        state.status = code
        return res
      },
      send: (body: string) => {
        state.body = body
        return res
      },
      end: () => res,
    }
    return { res: res as unknown as Response, headers, state }
  }

  const headRequest = (range: string) =>
    ({
      headers: { authorization: VALID_AUTH, range },
      params: { key: 'a-bucket/a-key' },
      query: {},
    }) as unknown as Request

  /** A GetObject result for a 70-byte object. */
  const seventyBytes = {
    metadata: {
      name: 'blob.bin',
      type: 'file',
      mimeType: 'application/octet-stream',
      size: BigInt(70),
      isCompressed: false,
      isEncrypted: false,
    },
    startDownload: async () => Readable.from([]),
    byteRange: [60, 69],
    cid: 'bafyTheOnlyVersion',
    etag: '"a0d4b097"',
    lastModified: new Date(0),
    mtime: null,
    objectMetadata: null,
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const authenticated = () =>
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(createMockUser() as never)

  it('reads once, handing the suffix to the use case', async () => {
    authenticated()
    const getObject = jest
      .spyOn(S3UseCases, 'getObject')
      .mockResolvedValue(ok(seventyBytes) as never)

    await headObjectHandler(headRequest('bytes=-10'), stubRes().res)

    // One lookup: there is no window for an overwrite to open, and no
    // object_versions row has to exist for the read to succeed.
    expect(getObject).toHaveBeenCalledTimes(1)
    expect(getObject.mock.calls[0][1]).toMatchObject({
      Bucket: 'a-bucket',
      Key: 'a-key',
      SuffixLength: 10,
    })
    // No absolute Range: the controller never computed one.
    expect(getObject.mock.calls[0][1]).not.toHaveProperty('Range')
  })

  it('reads once for an offset range too', async () => {
    authenticated()
    const getObject = jest
      .spyOn(S3UseCases, 'getObject')
      .mockResolvedValue(ok(seventyBytes) as never)

    await headObjectHandler(headRequest('bytes=0-9'), stubRes().res)

    expect(getObject).toHaveBeenCalledTimes(1)
    expect(getObject.mock.calls[0][1]).toMatchObject({ Range: [0, 9] })
    expect(getObject.mock.calls[0][1]).not.toHaveProperty('SuffixLength')
  })

  it('renders the size the use case could not satisfy', async () => {
    authenticated()
    jest
      .spyOn(S3UseCases, 'getObject')
      .mockResolvedValue(
        err(new RangeNotSatisfiableError('nope', BigInt(70))) as never,
      )

    const { res, headers, state } = stubRes()
    await headObjectHandler(headRequest('bytes=-0'), res)

    // 416 has to name the real size, which is how a client learns what to ask
    // for instead — so the error carries it up from where the cid was read.
    expect(state.status).toBe(416)
    expect(headers.get('content-range')).toBe('bytes */70')
    expect(state.body).toContain('<Code>InvalidRange</Code>')
    expect(state.body).toContain('<ActualObjectSize>70</ActualObjectSize>')
  })
})
