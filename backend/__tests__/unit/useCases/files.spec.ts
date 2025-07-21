import { jest } from '@jest/globals'
import { ObjectUseCases } from '../../../src/useCases/objects/object.js'
import { ObjectStatus } from '@auto-drive/models'
import { ByteRange } from '@autonomys/file-caching'
import { DownloadUseCase } from '../../../src/useCases/objects/downloads.js'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { FilesUseCases } from '../../../src/useCases/index.js'

jest.unstable_mockModule('../../../src/useCases/objects/object.js', () => ({
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

    jest.spyOn(ObjectUseCases, 'getObjectInformation').mockResolvedValue({
      metadata,
      tags: [],
      cid: '<cid>',
      createdAt: '',
      status: ObjectStatus.Processing,
      uploadState: {
        uploadedNodes: 0,
        totalNodes: 0,
        archivedNodes: 0,
        minimumBlockDepth: 0,
        maximumBlockDepth: 0,
      },
      owners: [],
      publishedObjectId: null,
    })
    jest.spyOn(ObjectUseCases, 'shouldBlockDownload').mockResolvedValue(false)

    const result = await DownloadUseCase.downloadObjectByAnonymous(
      metadata.dataCid,
    )

    // Expect not to throw
    expect(result.metadata).toEqual(metadata)
  })

  it('should block file upload', async () => {
    const mockFile = {
      cid: 'test-cid',
      type: 'file',
    }

    jest.spyOn(ObjectUseCases, 'getObjectInformation').mockResolvedValue({
      metadata: {
        totalSize: 100n,
        type: 'file',
        dataCid: 'test-cid',
        totalChunks: 1,
        chunks: [],
      },
      tags: ['insecure'],
      cid: '',
      createdAt: '',
      status: ObjectStatus.Processing,
      uploadState: {
        uploadedNodes: 0,
        totalNodes: 0,
        archivedNodes: 0,
        minimumBlockDepth: 0,
        maximumBlockDepth: 0,
      },
      owners: [],
      publishedObjectId: null,
    })
    jest.spyOn(ObjectUseCases, 'shouldBlockDownload').mockResolvedValue(true)

    await expect(
      DownloadUseCase.downloadObjectByAnonymous(mockFile.cid, {
        blockingTags: ['insecure'],
      }),
    ).rejects.toThrow(new Error('File is blocked'))
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
