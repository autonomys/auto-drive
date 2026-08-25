import { describe, it, expect, jest, afterEach } from '@jest/globals'
import type { Request, Response } from 'express'
import { Readable } from 'stream'
import { ok } from 'neverthrow'
import {
  headObjectHandler,
  parseS3Range,
  resolveSuffixRange,
} from '../../../src/app/controllers/s3/s3.js'
import { S3UseCases } from '../../../src/core/s3/index.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { createMockUser } from '../../utils/mocks.js'

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

// A suffix range is the one shape that has to measure the object before it can
// name any bytes, so it reads twice: once for the size, once for the body. The
// two reads have to land on the SAME object. Resolving `bytes=-10` against a
// 70-byte version and then reading `bucket/key` afresh lets a PutObject in
// between answer the request out of new content, using offsets sized for the old
// — a 206 carrying the new ETag and version id over the wrong ten bytes, which
// is exactly the silent, plausible, wrong data the strict parser exists to stop.
describe('a suffix range pins the body to the version it measured', () => {
  const VALID_AUTH =
    'AWS4-HMAC-SHA256 Credential=e046e71c8dc3459c8da189e62418203a/20260821/us-west-2/s3/aws4_request, SignedHeaders=host, Signature=0'

  const OLD_CID = 'bafyOldVersion'
  const NEW_CID = 'bafyNewVersion'

  /** Minimal Response stand-in: the handler only has to reach its second read. */
  const stubRes = () => {
    const headers = new Map<string, string>()
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
      status: () => res,
      send: () => res,
      end: () => res,
    }
    return { res: res as unknown as Response, headers }
  }

  const headRequest = (range: string) =>
    ({
      headers: { authorization: VALID_AUTH, range },
      params: { key: 'a-bucket/a-key' },
      query: {},
    }) as unknown as Request

  /** A GetObject result for a 70-byte object stored under `cid`. */
  const objectOf = (cid: string) => ({
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
    cid,
    etag: `"${cid}-md5"`,
    lastModified: new Date(0),
    mtime: null,
    objectMetadata: null,
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reads the body at the versionId the size came from', async () => {
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(createMockUser() as never)
    // The overwrite lands between the two reads: an unpinned second lookup
    // resolves the key to NEW_CID.
    const getObject = jest
      .spyOn(S3UseCases, 'getObject')
      .mockResolvedValueOnce(ok(objectOf(OLD_CID)) as never)
      .mockResolvedValueOnce(ok(objectOf(NEW_CID)) as never)

    const { res } = stubRes()
    await headObjectHandler(headRequest('bytes=-10'), res)

    expect(getObject).toHaveBeenCalledTimes(2)
    // The probe reads the current version; nothing to pin to yet.
    expect(getObject.mock.calls[0][1]).toMatchObject({
      Bucket: 'a-bucket',
      Key: 'a-key',
      VersionId: undefined,
    })
    // The body read is pinned, so the offsets computed from the measured size
    // are applied to the object they were measured on.
    expect(getObject.mock.calls[1][1]).toMatchObject({
      Bucket: 'a-bucket',
      Key: 'a-key',
      VersionId: OLD_CID,
      Range: [60, 69],
    })
  })

  it('leaves an offset range on a single unpinned read', async () => {
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(createMockUser() as never)
    const getObject = jest
      .spyOn(S3UseCases, 'getObject')
      .mockResolvedValue(ok(objectOf(NEW_CID)) as never)

    const { res } = stubRes()
    await headObjectHandler(headRequest('bytes=0-9'), res)

    // An offset range names its bytes without knowing the size, so it never
    // measures first and has no earlier version to be torn from.
    expect(getObject).toHaveBeenCalledTimes(1)
    expect(getObject.mock.calls[0][1]).toMatchObject({ VersionId: undefined })
  })

  it('keeps the client\'s own ?versionId when it asks for a suffix of it', async () => {
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(createMockUser() as never)
    const getObject = jest
      .spyOn(S3UseCases, 'getObject')
      .mockResolvedValue(ok(objectOf(OLD_CID)) as never)

    const req = headRequest('bytes=-10')
    ;(req.query as Record<string, string>).versionId = OLD_CID
    const { res } = stubRes()
    await headObjectHandler(req, res)

    // Both reads name the version the client asked for: it cannot be overwritten
    // under them, so the pin is the same value they already sent.
    expect(getObject.mock.calls[0][1]).toMatchObject({ VersionId: OLD_CID })
    expect(getObject.mock.calls[1][1]).toMatchObject({ VersionId: OLD_CID })
  })
})
