import { jest } from '@jest/globals'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { FilesUseCases } from '../../../src/core/objects/files/index.js'
import { DownloadUseCase } from '../../../src/core/downloads/index.js'
import { ByteRange } from '@autonomys/file-server'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { NotAcceptableError } from '../../../src/errors/index.js'
import { err, ok } from 'neverthrow'

jest.unstable_mockModule('../../../src/core/objects/object.js', () => ({
  ObjectUseCases: {
    getObjectInformation: jest.fn(),
  },
}))

describe('FilesUseCases', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(async () => {
    jest.restoreAllMocks()
  })

  it('should handle file upload', async () => {
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'test-cid',
      totalChunks: 1,
      chunks: [],
    }

    jest.spyOn(ObjectUseCases, 'getMetadata').mockResolvedValue(ok(metadata))
    jest.spyOn(ObjectUseCases, 'authorizeDownload').mockResolvedValue(ok())

    const result = await DownloadUseCase.downloadObjectByAnonymous(
      metadata.dataCid,
    )
    if (result.isErr()) {
      throw result.error
    }

    // Expect not to throw
    expect(result.value.metadata).toEqual({
      type: metadata.type,
    })
  })

  it('should block file upload', async () => {
    const mockFile = {
      cid: 'test-cid',
      type: 'file',
    }

    jest.spyOn(ObjectUseCases, 'getMetadata').mockResolvedValue(
      ok({
        totalSize: 100n,
        type: 'file',
        dataCid: 'test-cid',
        totalChunks: 1,
        chunks: [],
      }),
    )
    jest
      .spyOn(ObjectUseCases, 'authorizeDownload')
      .mockResolvedValue(err(new NotAcceptableError('File is blocked')))

    const result = await DownloadUseCase.downloadObjectByAnonymous(
      mockFile.cid,
      {
        blockingTags: ['insecure'],
      },
    )

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotAcceptableError)
  })

  describe('getNodesForPartialRetrieval', () => {
    const tests = [
      {
        name: 'should return the nodes for a partial retrieval',
        nodes: [
          { cid: 'test-cid', size: 100n },
          { cid: 'test-cid-2', size: 100n },
          { cid: 'test-cid-3', size: 50n },
        ],
        byteRange: [0, 99] as ByteRange,
        expectedNodes: ['test-cid'],
        expectedFirstNodeFileOffset: 0,
      },
      {
        name: 'should return the nodes for a partial retrieval',
        nodes: [
          { cid: 'test-cid', size: 100n },
          { cid: 'test-cid-2', size: 100n },
          { cid: 'test-cid-3', size: 50n },
        ],
        byteRange: [0, 100] as ByteRange,
        expectedNodes: ['test-cid', 'test-cid-2'],
        expectedFirstNodeFileOffset: 0,
      },
      {
        name: 'should return the nodes for a partial retrieval',
        nodes: [
          { cid: 'test-cid', size: 100n },
          { cid: 'test-cid-2', size: 100n },
          { cid: 'test-cid-3', size: 50n },
        ],
        byteRange: [1, 100] as ByteRange,
        expectedNodes: ['test-cid', 'test-cid-2'],
        expectedFirstNodeFileOffset: 0,
      },
      {
        name: 'should return the nodes for a partial retrieval',
        nodes: [
          { cid: 'test-cid', size: 100n },
          { cid: 'test-cid-2', size: 100n },
          { cid: 'test-cid-3', size: 50n },
        ],
        byteRange: [0, undefined] as ByteRange,
        expectedNodes: ['test-cid', 'test-cid-2', 'test-cid-3'],
        expectedFirstNodeFileOffset: 0,
      },
      {
        name: 'should return the nodes for a partial retrieval',
        nodes: [
          { cid: 'test-cid', size: 100n },
          { cid: 'test-cid-2', size: 100n },
          { cid: 'test-cid-3', size: 50n },
        ],
        byteRange: [100, undefined] as ByteRange,
        expectedNodes: ['test-cid-2', 'test-cid-3'],
        expectedFirstNodeFileOffset: 100,
      },
    ]

    for (const test of tests) {
      it(`${test.name} (byteRange=[${test.byteRange[0]},${test.byteRange[1]}])`, async () => {
        const result = await FilesUseCases.getNodesForPartialRetrieval(
          test.nodes,
          test.byteRange,
        )

        expect(result.nodes).toEqual(test.expectedNodes)
        expect(result.firstNodeFileOffset).toEqual(
          test.expectedFirstNodeFileOffset,
        )
      })
    }
  })
})
