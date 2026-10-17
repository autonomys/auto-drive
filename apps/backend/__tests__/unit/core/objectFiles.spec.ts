import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'

jest.unstable_mockModule('@keyvhq/sqlite', () => ({
  default: jest.fn(() => new Map()),
}))

const { FilesUseCases } = await import(
  '../../../src/core/objects/files/index.js'
)
const { DBObjectFetcher } = await import(
  '../../../src/core/objects/files/fetchers.js'
)
const { ObjectUseCases } = await import('../../../src/core/objects/object.js')
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { Readable } from 'stream'

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('FilesUseCases', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })


  describe('getNodesForPartialRetrieval', () => {
    it('should find nodes for byte range within single chunk', async () => {
      const chunks = [
        { size: BigInt(1000), cid: 'cid1' },
        { size: BigInt(1000), cid: 'cid2' },
      ]

      const result = await FilesUseCases.getNodesForPartialRetrieval(
        chunks as any,
        [100, 500],
      )

      expect(result.nodes).toContain('cid1')
      expect(result.firstNodeFileOffset).toBe(0)
    })

    it('should find nodes for byte range spanning multiple chunks', async () => {
      const chunks = [
        { size: BigInt(1000), cid: 'cid1' },
        { size: BigInt(1000), cid: 'cid2' },
        { size: BigInt(1000), cid: 'cid3' },
      ]

      const result = await FilesUseCases.getNodesForPartialRetrieval(
        chunks as any,
        [500, 2500],
      )

      expect(result.nodes.length).toBeGreaterThan(0)
      expect(result.firstNodeFileOffset).toBeDefined()
    })

    it('should handle byte range at end of file', async () => {
      const chunks = [
        { size: BigInt(1000), cid: 'cid1' },
        { size: BigInt(1000), cid: 'cid2' },
      ]

      const result = await FilesUseCases.getNodesForPartialRetrieval(
        chunks as any,
        [1500, undefined],
      )

      expect(result.nodes).toBeDefined()
      expect(result.firstNodeFileOffset).toBeDefined()
    })

    it('should select only the first chunk for a range ending at byte 0', async () => {
      const chunks = [
        { size: BigInt(1000), cid: 'cid1' },
        { size: BigInt(1000), cid: 'cid2' },
        { size: BigInt(1000), cid: 'cid3' },
      ]

      const result = await FilesUseCases.getNodesForPartialRetrieval(
        chunks as any,
        [0, 0],
      )

      expect(result.nodes).toEqual(['cid1'])
      expect(result.firstNodeFileOffset).toBe(0)
    })

    it('should throw error for byte range outside file', async () => {
      const chunks = [{ size: BigInt(1000), cid: 'cid1' }]

      await expect(
        FilesUseCases.getNodesForPartialRetrieval(chunks as any, [2000, 3000]),
      ).rejects.toThrow('Byte range not found')
    })
  })

  describe('retrieveFileByteRange', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('should fetch only the first chunk for bytes=0-0', async () => {
      const chunks = Array.from({ length: 250 }, (_, i) => ({
        size: BigInt(1000),
        cid: `chunk${i}`,
      }))
      const metadata: OffchainMetadata = {
        totalSize: '250000',
        dataCid: 'cid1',
        type: 'file',
        chunks,
      } as any

      jest.spyOn(ObjectUseCases, 'hasAllNodeData').mockResolvedValue(true)
      const fetchNodesSpy = jest
        .spyOn(DBObjectFetcher, 'fetchNodes')
        .mockImplementation(async (cids) =>
          cids.map(() => Buffer.alloc(1000, 7)),
        )

      const stream = await FilesUseCases.retrieveFileByteRange(metadata, [0, 0])
      const received: Buffer[] = []
      for await (const data of stream) received.push(data)

      expect(Buffer.concat(received)).toEqual(Buffer.from([7]))
      expect(fetchNodesSpy.mock.calls).toEqual([[['chunk0']]])
    })

    it('routes archived objects to DBObjectFetcher while local node data is still retained', async () => {
      const metadata: OffchainMetadata = {
        totalSize: '1000',
        dataCid: 'cid-retained',
        type: 'file',
        chunks: [{ size: BigInt(1000), cid: 'chunk-retained' }],
      } as any

      const hasAllNodeDataSpy = jest
        .spyOn(ObjectUseCases, 'hasAllNodeData')
        .mockResolvedValue(true)
      const dbFetchFileSpy = jest
        .spyOn(DBObjectFetcher, 'fetchFile')
        .mockResolvedValue(Readable.from([Buffer.from('local-bytes')]))

      const stream = await FilesUseCases.retrieveFullFile(metadata)
      const received: Buffer[] = []
      for await (const data of stream) received.push(data)

      expect(hasAllNodeDataSpy).toHaveBeenCalledWith(metadata)
      expect(dbFetchFileSpy).toHaveBeenCalledWith('cid-retained')
      expect(Buffer.concat(received).toString('utf8')).toBe('local-bytes')
    })

    it('falls back to DBObjectFetcher when FileGatewayObjectFetcher.fetchFile fails and local node data exists', async () => {
      const { FileGatewayObjectFetcher } = await import(
        '../../../src/core/objects/files/fetchers.js'
      )
      const { FileGateway } = await import(
        '../../../src/infrastructure/services/dsn/fileGateway/index.js'
      )
      const { ok } = await import('neverthrow')

      const metadata: OffchainMetadata = {
        totalSize: '5',
        dataCid: 'cid-fallback',
        type: 'file',
        chunks: [{ size: BigInt(5), cid: 'chunk-fallback' }],
      } as any

      jest.spyOn(ObjectUseCases, 'getMetadata').mockResolvedValue(ok(metadata))
      jest
        .spyOn(FileGateway, 'getFile')
        .mockRejectedValue(new Error('404 Not found: Failed to get node metadata'))
      jest.spyOn(ObjectUseCases, 'hasAllNodeData').mockResolvedValue(true)
      const dbFetchFileSpy = jest
        .spyOn(DBObjectFetcher, 'fetchFile')
        .mockResolvedValue(Readable.from([Buffer.from('hello')]))

      const stream = await FileGatewayObjectFetcher.fetchFile('cid-fallback')
      const received: Buffer[] = []
      for await (const data of stream) received.push(data)

      expect(dbFetchFileSpy).toHaveBeenCalledWith('cid-fallback')
      expect(Buffer.concat(received).toString('utf8')).toBe('hello')
    })
  })


  describe('retrieveObject', () => {
    it('should return empty readable for zero-size files', async () => {
      const metadata: OffchainMetadata = {
        totalSize: '0',
        dataCid: 'cid1',
        type: 'file',
      } as any

      const result = await FilesUseCases.retrieveObject(metadata)

      expect(result).toBeInstanceOf(Readable)
    })

    it('should call retrieveFullFile when no byte range specified', async () => {
      const metadata: OffchainMetadata = {
        totalSize: '1000',
        dataCid: 'cid1',
        type: 'file',
        chunks: [{ size: BigInt(1000), cid: 'chunk1' }],
      } as any

      const retrieveFullFileSpy = jest
        .spyOn(FilesUseCases, 'retrieveFullFile')
        .mockResolvedValue(new Readable())

      jest
        .spyOn(FilesUseCases, 'retrieveFileByteRange')
        .mockResolvedValue(new Readable())

      // Test full retrieval
      const fullResult = await FilesUseCases.retrieveObject(metadata)
      expect(fullResult).toBeDefined()

      expect(retrieveFullFileSpy).toHaveBeenCalledWith(metadata)
    })

    it('should call retrieveFileByteRange when byte range specified', async () => {
      const metadata: OffchainMetadata = {
        totalSize: '2000',
        dataCid: 'cid1',
        type: 'file',
        chunks: [
          { size: BigInt(1000), cid: 'chunk1' },
          { size: BigInt(1000), cid: 'chunk2' },
        ],
      } as any

      const retrieveFileByteRangeSpy = jest
        .spyOn(FilesUseCases, 'retrieveFileByteRange')
        .mockResolvedValue(new Readable())

      await FilesUseCases.retrieveObject(metadata, {
        byteRange: [0, 100],
      })

      expect(retrieveFileByteRangeSpy).toHaveBeenCalledWith(metadata, [0, 100])
    })
  })

  describe('archival retention and reclaim sweep', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('onObjectArchived marks metadata archived without stripping node data immediately', async () => {
      const { metadataRepository, nodesRepository } = await import(
        '../../../src/infrastructure/repositories/index.js'
      )
      const markAsArchivedSpy = jest
        .spyOn(metadataRepository, 'markAsArchived')
        .mockResolvedValue(undefined as any)
      const removeNodeDataSpy = jest
        .spyOn(nodesRepository, 'removeNodeDataByRootCid')
        .mockResolvedValue(undefined as any)

      await ObjectUseCases.onObjectArchived('cid-newly-archived')

      expect(markAsArchivedSpy).toHaveBeenCalledWith('cid-newly-archived')
      expect(removeNodeDataSpy).not.toHaveBeenCalled()
    })

    it('reclaimArchivedNodeData strips node data only when FileGateway confirms retrievability', async () => {
      const { nodesRepository } = await import(
        '../../../src/infrastructure/repositories/index.js'
      )
      const { FileGateway } = await import(
        '../../../src/infrastructure/services/dsn/fileGateway/index.js'
      )
      jest
        .spyOn(nodesRepository, 'getArchivedRootCidsWithData')
        .mockResolvedValue(['cid-not-ready', 'cid-ready'])
      jest
        .spyOn(FileGateway, 'isRetrievableFromGateway')
        .mockImplementation(async (cid) => cid === 'cid-ready')
      const removeNodeDataSpy = jest
        .spyOn(nodesRepository, 'removeNodeDataByRootCid')
        .mockResolvedValue(undefined as any)

      await ObjectUseCases.reclaimArchivedNodeData()

      expect(removeNodeDataSpy).toHaveBeenCalledTimes(1)
      expect(removeNodeDataSpy).toHaveBeenCalledWith('cid-ready')
    })
  })
})

