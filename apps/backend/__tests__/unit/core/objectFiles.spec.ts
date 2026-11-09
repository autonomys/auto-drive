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
const { config } = await import('../../../src/config.js')
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { Readable } from 'stream'

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('FilesUseCases', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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

      jest.spyOn(ObjectUseCases, 'isArchived').mockResolvedValue(true)
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

    it('routes unarchived (pre-migration) objects directly to DBObjectFetcher', async () => {
      const metadata: OffchainMetadata = {
        totalSize: '1000',
        dataCid: 'cid-pre-migration',
        type: 'file',
        chunks: [{ size: BigInt(1000), cid: 'chunk-pre-migration' }],
      } as any

      jest.spyOn(ObjectUseCases, 'isArchived').mockResolvedValue(false)
      const hasAllNodeDataSpy = jest.spyOn(ObjectUseCases, 'hasAllNodeData')
      const dbFetchFileSpy = jest
        .spyOn(DBObjectFetcher, 'fetchFile')
        .mockResolvedValue(Readable.from([Buffer.from('blockstore-bytes')]))

      const stream = await FilesUseCases.retrieveFullFile(metadata)
      const received: Buffer[] = []
      for await (const data of stream) received.push(data)

      expect(hasAllNodeDataSpy).not.toHaveBeenCalled()
      expect(dbFetchFileSpy).toHaveBeenCalledWith('cid-pre-migration')
      expect(Buffer.concat(received).toString('utf8')).toBe('blockstore-bytes')
    })

    it('routes archived objects to DBObjectFetcher while local node data is still retained', async () => {
      const metadata: OffchainMetadata = {
        totalSize: '1000',
        dataCid: 'cid-retained',
        type: 'file',
        chunks: [{ size: BigInt(1000), cid: 'chunk-retained' }],
      } as any

      jest.spyOn(ObjectUseCases, 'isArchived').mockResolvedValue(true)
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

    beforeEach(async () => {
      const { metadataRepository } = await import(
        '../../../src/infrastructure/repositories/index.js'
      )
      jest
        .spyOn(metadataRepository, 'getMetadata')
        .mockImplementation(async (cid) => ({
          root_cid: cid,
          head_cid: cid,
          name: 'test.bin',
          metadata: { type: 'file', totalSize: 1000n, dataCid: cid, chunks: [] },
          is_archived: true,
          created_at: new Date(),
          tags: null,
        } as any))
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

    it('advances cursor across sweeps when a full batch of CIDs is not yet retrievable', async () => {
      const { nodesRepository } = await import(
        '../../../src/infrastructure/repositories/index.js'
      )
      const { FileGateway } = await import(
        '../../../src/infrastructure/services/dsn/fileGateway/index.js'
      )
      const batchSize = config.reclaim.batchSize
      const prevMaxFailures = config.reclaim.maxConsecutiveProbeFailures
      config.reclaim.maxConsecutiveProbeFailures = batchSize + 1
      try {
        const fullUnconfirmedBatch = Array.from(
          { length: batchSize },
          (_, i) => `cid-unconfirmed-${String(i).padStart(3, '0')}`,
        )

        const getArchivedSpy = jest
          .spyOn(nodesRepository, 'getArchivedRootCidsWithData')
          .mockImplementation(async (_limit, afterCid) => {
            if (!afterCid) return fullUnconfirmedBatch
            return ['cid-confirmed-next-page']
          })
        jest
          .spyOn(FileGateway, 'isRetrievableFromGateway')
          .mockImplementation(async (cid) => cid === 'cid-confirmed-next-page')
        const removeNodeDataSpy = jest
          .spyOn(nodesRepository, 'removeNodeDataByRootCid')
          .mockResolvedValue(undefined as any)

        // Sweep 1 hits a full batch of unconfirmed CIDs
        await ObjectUseCases.reclaimArchivedNodeData()
        expect(getArchivedSpy).toHaveBeenLastCalledWith(batchSize, null)
        expect(removeNodeDataSpy).not.toHaveBeenCalled()

        // Sweep 2 advances past the last CID of Sweep 1 instead of stalling
        await ObjectUseCases.reclaimArchivedNodeData()
        expect(getArchivedSpy).toHaveBeenLastCalledWith(
          batchSize,
          fullUnconfirmedBatch[batchSize - 1],
        )
        expect(removeNodeDataSpy).toHaveBeenCalledWith('cid-confirmed-next-page')
      } finally {
        config.reclaim.maxConsecutiveProbeFailures = prevMaxFailures
      }
    })

    it('does not advance cursor past unvisited CIDs when aborted mid-sweep', async () => {
      const { nodesRepository } = await import(
        '../../../src/infrastructure/repositories/index.js'
      )
      const { FileGateway } = await import(
        '../../../src/infrastructure/services/dsn/fileGateway/index.js'
      )
            const batchSize = config.reclaim.batchSize

      const batch = Array.from({ length: batchSize }, (_, i) => `cid-abort-${i}`)
      const remainingBatch = batch.slice(2)
      const getArchivedSpy = jest
        .spyOn(nodesRepository, 'getArchivedRootCidsWithData')
        .mockImplementation(async (_limit, afterCid) => {
          if (!afterCid) return batch
          if (afterCid === 'cid-abort-1') return remainingBatch
          return []
        })

      const controller = new AbortController()
      const gatewayCalls: string[] = []
      jest
        .spyOn(FileGateway, 'isRetrievableFromGateway')
        .mockImplementation(async (cid) => {
          gatewayCalls.push(cid)
          if (cid === 'cid-abort-1') controller.abort()
          return false
        })

      await ObjectUseCases.reclaimArchivedNodeData(controller.signal)

      expect(gatewayCalls).toEqual(['cid-abort-0', 'cid-abort-1'])

      // The next sweep must resume after cid-abort-1 (the last visited), not the end of the batch
      await ObjectUseCases.reclaimArchivedNodeData()
      expect(getArchivedSpy).toHaveBeenLastCalledWith(batchSize, 'cid-abort-1')
      expect(gatewayCalls).toContain('cid-abort-2')
    })
    it('skips folder roots in reclaim sweep to preserve child nodes', async () => {
      const { nodesRepository, metadataRepository } = await import(
        '../../../src/infrastructure/repositories/index.js'
      )
      const { FileGateway } = await import(
        '../../../src/infrastructure/services/dsn/fileGateway/index.js'
      )

      jest
        .spyOn(nodesRepository, 'getArchivedRootCidsWithData')
        .mockResolvedValue(['cid-folder-root'])
      jest
        .spyOn(metadataRepository, 'getMetadata')
        .mockImplementation(async (cid) => ({
          root_cid: cid,
          head_cid: cid,
          name: 'my-folder',
          metadata: { type: 'folder', totalSize: 5000n, dataCid: cid, chunks: [] },
          is_archived: true,
          created_at: new Date(),
          tags: null,
        } as any))
      const gatewaySpy = jest.spyOn(FileGateway, 'isRetrievableFromGateway')
      const removeSpy = jest.spyOn(nodesRepository, 'removeNodeDataByRootCid')

      await ObjectUseCases.reclaimArchivedNodeData()

      expect(gatewaySpy).not.toHaveBeenCalled()
      expect(removeSpy).not.toHaveBeenCalled()
    })

    it('stops reclaim sweep early when consecutive probe failures reach the threshold', async () => {
      const { nodesRepository } = await import(
        '../../../src/infrastructure/repositories/index.js'
      )
      const { FileGateway } = await import(
        '../../../src/infrastructure/services/dsn/fileGateway/index.js'
      )
      
      const cids = ['cid-fail-1', 'cid-fail-2', 'cid-fail-3', 'cid-fail-4', 'cid-fail-5']
      jest
        .spyOn(nodesRepository, 'getArchivedRootCidsWithData')
        .mockResolvedValue(cids)
      const gatewayCalls: string[] = []
      jest
        .spyOn(FileGateway, 'isRetrievableFromGateway')
        .mockImplementation(async (cid) => {
          gatewayCalls.push(cid)
          return false
        })

      await ObjectUseCases.reclaimArchivedNodeData()

      // Should stop after config.reclaim.maxConsecutiveProbeFailures (3)
      expect(gatewayCalls).toEqual(['cid-fail-1', 'cid-fail-2', 'cid-fail-3'])
    })

  })
})

