import { jest } from '@jest/globals'
import { ObjectUseCases } from '../../../src/useCases/objects/object.js'
import { FilesUseCases } from '../../../src/useCases/objects/files.js'
import { ObjectStatus } from '@auto-drive/models'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { config } from '../../../src/config.js'

jest.unstable_mockModule('../../../src/useCases/objects/object.js', () => ({
  ObjectUseCases: {
    getObjectInformation: jest.fn(),
  },
}))

describe('FilesUseCases', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  beforeAll(() => {})

  it('should handle file upload', async () => {
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'test-cid',
      totalChunks: 1,
      chunks: [],
    }

    jest.spyOn(ObjectUseCases, 'getObjectInformation').mockResolvedValue({
      metadata: metadata,
      tags: [],
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

    const result = await FilesUseCases.downloadObjectByAnonymous(
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

    expect(
      FilesUseCases.downloadObjectByAnonymous(mockFile.cid, ['insecure']),
    ).rejects.toThrow(new Error('File is blocked'))
  })

  it('should throw if file is too large', async () => {
    const metadata: OffchainMetadata = {
      totalSize: BigInt(config.params.maxAnonymousDownloadSize) + 1n,
      type: 'file',
      dataCid: 'test-cid',
      totalChunks: 1,
      chunks: [],
    }

    jest.spyOn(ObjectUseCases, 'getObjectInformation').mockResolvedValue({
      metadata: metadata,
      tags: [],
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

    expect(
      FilesUseCases.downloadObjectByAnonymous(metadata.dataCid),
    ).rejects.toThrow(new Error('File too large to be downloaded anonymously.'))
  })
})
