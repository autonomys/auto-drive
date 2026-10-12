import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { FilesUseCases } from '../../../src/core/objects/files/index.js'
import { DBObjectFetcher } from '../../../src/core/objects/files/fetchers.js'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
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

      jest.spyOn(ObjectUseCases, 'isArchived').mockResolvedValue(false)
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
})
