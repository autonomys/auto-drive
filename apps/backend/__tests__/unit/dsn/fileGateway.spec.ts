import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { isRetrievableFromGateway } from '../../../src/infrastructure/services/dsn/fileGateway/index.js'

describe('FileGateway.isRetrievableFromGateway', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns true immediately for zero-size objects without probing', async () => {
    const fetchMock = jest.fn<typeof fetch>()
    global.fetch = fetchMock

    const result = await isRetrievableFromGateway('cid-empty', 0n)
    expect(result).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('probes last byte with originControl=no-cache and returns true on 206 with body', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([42]))
        controller.close()
      },
    })

    const fetchMock = jest.fn<typeof fetch>().mockImplementation(async () => {
      return {
        status: 206,
        body: stream,
      } as unknown as Response
    })
    global.fetch = fetchMock

    const result = await isRetrievableFromGateway('cid-file', 1000n)
    expect(result).toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/files/cid-file?originControl=no-cache')
    expect(
      (opts?.headers as Record<string, string> | undefined)?.['Range'],
    ).toBe('bytes=999-999')
  })

  it('returns false when gateway returns non-206 status', async () => {
    const cancelMock = jest.fn<() => Promise<void>>().mockResolvedValue()
    global.fetch = jest.fn<typeof fetch>().mockImplementation(async () => {
      return {
        status: 404,
        body: { cancel: cancelMock },
      } as unknown as Response
    })

    const result = await isRetrievableFromGateway('cid-missing', 500n)
    expect(result).toBe(false)
  })

  it('returns false when gateway request times out or rejects', async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockImplementation(async () => {
        throw new Error('Gateway probe timeout')
      })

    const result = await isRetrievableFromGateway('cid-timeout', 500n)
    expect(result).toBe(false)
  })
})
