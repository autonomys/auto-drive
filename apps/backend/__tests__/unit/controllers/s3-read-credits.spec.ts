import { describe, it, expect, jest, afterEach } from '@jest/globals'
import type { Request, Response } from 'express'
import { Readable } from 'stream'
import { ok } from 'neverthrow'
import {
  getObjectHandler,
  headObjectHandler,
} from '../../../src/app/controllers/s3/s3.js'
import { S3UseCases } from '../../../src/core/s3/index.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { PaymentRequiredError } from '../../../src/errors/index.js'
import { createMockUser } from '../../utils/mocks.js'

// S3 reads are charged to the caller's download credits, and the credit check
// and the charge both live inside startDownload(). These pin the two handler
// behaviours that depend on that.
describe('S3 reads and download credits', () => {
  const VALID_AUTH =
    'AWS4-HMAC-SHA256 Credential=e046e71c8dc3459c8da189e62418203a/20260821/us-west-2/s3/aws4_request, SignedHeaders=host, Signature=0'

  const stubRes = () => {
    const headers = new Map<string, string>()
    const state: { status?: number; body?: string } = {}
    const res = {
      headersSent: false,
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

  const request = () =>
    ({
      headers: { authorization: VALID_AUTH },
      params: { key: 'a-bucket/a-key' },
      query: {},
    }) as unknown as Request

  const download = (startDownload: () => Promise<Readable>) => ({
    metadata: {
      name: 'large.bin',
      type: 'file',
      mimeType: 'application/octet-stream',
      size: BigInt(200 * 1024 * 1024),
      isCompressed: false,
      isEncrypted: false,
    },
    startDownload,
    byteRange: undefined,
    cid: 'bafyLarge',
    etag: '"a0d4b097"',
    lastModified: new Date(0),
    mtime: null,
    objectMetadata: null,
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const authenticated = () =>
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockResolvedValue(createMockUser() as never)

  it('HeadObject never starts the download, so it spends no credits', async () => {
    authenticated()
    const startDownload = jest.fn(async () => Readable.from([]))
    jest
      .spyOn(S3UseCases, 'getObject')
      .mockResolvedValue(ok(download(startDownload)) as never)

    const { res, headers, state } = stubRes()
    await headObjectHandler(request(), res)

    expect(startDownload).not.toHaveBeenCalled()
    expect(state.status).toBeUndefined()
    expect(headers.get('content-length')).toBe(String(200 * 1024 * 1024))
  })

  it('GetObject answers an out-of-credits read with a 402 PaymentRequired XML error', async () => {
    authenticated()
    jest.spyOn(S3UseCases, 'getObject').mockResolvedValue(
      ok(
        download(async () => {
          throw new PaymentRequiredError(
            'Insufficient credits to process download',
          )
        }),
      ) as never,
    )

    const { res, headers, state } = stubRes()
    await expect(getObjectHandler(request(), res)).resolves.toBeUndefined()

    expect(state.status).toBe(402)
    expect(headers.get('content-type')).toBe('application/xml')
    expect(state.body).toContain('<Code>PaymentRequired</Code>')
    expect(state.body).toContain(
      '<Message>Insufficient credits to process download</Message>',
    )
    // Refused before any object header was staged.
    expect(headers.has('etag')).toBe(false)
    expect(headers.has('x-amz-meta-cid')).toBe(false)
  })
})
