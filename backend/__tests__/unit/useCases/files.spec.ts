import { jest } from '@jest/globals'
import { ObjectUseCases } from '../../../src/useCases/objects/object.js'
import { FilesUseCases } from '../../../src/useCases/objects/files.js'
import { OffchainMetadata } from '@autonomys/auto-dag-data'

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

    jest.spyOn(ObjectUseCases, 'getMetadata').mockResolvedValue(metadata)
    jest.spyOn(ObjectUseCases, 'shouldBlockDownload').mockResolvedValue(false)

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

    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'test-cid',
      totalChunks: 1,
      chunks: [],
    }

    jest.spyOn(ObjectUseCases, 'getMetadata').mockResolvedValue(metadata)
    jest.spyOn(ObjectUseCases, 'shouldBlockDownload').mockResolvedValue(true)

    await expect(
      FilesUseCases.downloadObjectByAnonymous(mockFile.cid, ['insecure']),
    ).rejects.toThrow(
      new Error('File download is blocked by blocking tags or is banned'),
    )
  })
})
