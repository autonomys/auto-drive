import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { UploadsUseCases } from '../../../src/useCases/uploads/uploads.js'
import {
  UserWithOrganization,
  Upload,
  UploadStatus,
  UploadType,
  InteractionType,
  OwnerRole,
  TransactionStatus,
} from '@auto-drive/models'
import { blockstoreRepository } from '../../../src/repositories/uploads/index.js'
import { MemoryBlockstore } from 'blockstore-core'
import {
  processFileToIPLDFormat,
  MetadataType,
  DEFAULT_MAX_CHUNK_SIZE,
  cidToString,
  blake3HashFromCid,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { ObjectUseCases } from '../../../src/useCases/objects/object.js'
import { uploadsRepository } from '../../../src/repositories/uploads/uploads.js'
import { asyncIterableToPromiseOfArray } from '@autonomys/asynchronous'
import {
  FilesUseCases,
  NodesUseCases,
  SubscriptionsUseCases,
} from '../../../src/useCases/index.js'
import {
  interactionsRepository,
  metadataRepository,
  nodesRepository,
} from '../../../src/repositories/index.js'
import { memoryDownloadCache } from '../../../src/services/download/memoryDownloadCache/index.js'
import { jest } from '@jest/globals'
import { downloadService } from '../../../src/services/download/index.js'
import { BlockstoreUseCases } from '../../../src/useCases/uploads/blockstore.js'
import { Rabbit } from '../../../src/drivers/rabbit.js'

const files = [
  {
    filename: 'test.pdf',
    mimeType: 'application/pdf',
    rndBuffer: Buffer.alloc(1024 ** 2).fill(0),
  },
  {
    filename: 'test.txt',
    mimeType: null,
    rndBuffer: Buffer.alloc(1024).fill(0),
  },
]

files.map((file, index) => {
  describe(`File Upload #${index + 1}`, () => {
    const user: UserWithOrganization = createMockUser()
    let rabbitMock: jest.SpiedFunction<typeof Rabbit.publish>

    beforeAll(async () => {
      await dbMigration.up()
    })

    afterAll(async () => {
      await dbMigration.down()
    })

    beforeEach(() => {
      rabbitMock = mockRabbitPublish()
    })

    afterEach(() => {
      unmockMethods()
    })

    const { filename, mimeType, rndBuffer } = file
    const fileSize = rndBuffer.length
    const TOTAL_CHUNKS = Math.max(
      1,
      Math.ceil(fileSize / DEFAULT_MAX_CHUNK_SIZE),
    )

    let upload: Upload
    let cid: string

    describe('Upload initiation', () => {
      it('should create an upload', async () => {
        upload = await UploadsUseCases.createFileUpload(
          user,
          filename,
          mimeType,
          null,
          null,
          null,
        )

        expect(upload).toMatchObject({
          id: expect.any(String),
          name: filename,
          mimeType,
          oauthProvider: user.oauthProvider,
          oauthUserId: user.oauthUserId,
          fileTree: null,
          status: UploadStatus.PENDING,
          type: UploadType.FILE,
          relativeId: null,
        })
      })

      it('should upload chunks correctly', async () => {
        const CHUNK_SIZE = DEFAULT_MAX_CHUNK_SIZE
        for (let i = 0; i < fileSize; i += CHUNK_SIZE) {
          const uploadedChunkPromise = UploadsUseCases.uploadChunk(
            user,
            upload.id,
            Math.floor(i / CHUNK_SIZE),
            Buffer.from(rndBuffer.subarray(i, i + CHUNK_SIZE)),
          )

          await expect(uploadedChunkPromise).resolves.not.toThrow()
        }

        const postUploadedChunks = await blockstoreRepository.getByType(
          upload.id,
          MetadataType.FileChunk,
        )

        const PENDING_CHUNK_DUE_TO_COMPLETION = 1 // The last chunk is pending due to the upload not being completed
        const EXPECTED_CHUNKS = TOTAL_CHUNKS - PENDING_CHUNK_DUE_TO_COMPLETION

        expect(postUploadedChunks.length).toBe(EXPECTED_CHUNKS)
      })
    })

    describe('Upload completion', () => {
      it('should be able to complete the upload and return the correct CID', async () => {
        const blockstore = new MemoryBlockstore()
        const expectedCID = await processFileToIPLDFormat(
          blockstore,
          [rndBuffer],
          BigInt(fileSize),
          filename,
        )
        cid = await UploadsUseCases.completeUpload(user, upload.id)

        expect(rabbitMock).toHaveBeenCalledWith({
          id: 'migrate-upload-nodes',
          params: {
            uploadId: upload.id,
          },
        })

        expect(cid).toBe(cidToString(expectedCID))
      })

      it('should have generated expected number of chunks and file', async () => {
        let postUploadedChunks = await blockstoreRepository.getByType(
          upload.id,
          MetadataType.FileChunk,
        )
        if (postUploadedChunks.length === 0) {
          postUploadedChunks = await blockstoreRepository.getByType(
            upload.id,
            MetadataType.File,
          )
        }
        expect(postUploadedChunks).toHaveLength(TOTAL_CHUNKS)

        const postUploadedFile = await blockstoreRepository.getByType(
          upload.id,
          MetadataType.File,
        )
        expect(postUploadedFile).toHaveLength(1)
      })

      it('should have generated expected metadata', async () => {
        const metadata = await ObjectUseCases.getMetadata(cid)

        expect(metadata).toMatchObject({
          type: 'file',
          dataCid: cid,
          name: filename,
          totalSize: BigInt(fileSize).toString(),
          totalChunks: TOTAL_CHUNKS,
          chunks: expect.any(Array),
          ...(mimeType ? { mimeType } : {}),
        })
      })

      it('should be in MIGRATING status', async () => {
        const uploadEntry = await uploadsRepository.getUploadEntryById(
          upload.id,
        )
        expect(uploadEntry).not.toBeNull()
        expect(uploadEntry!.status).toBe(UploadStatus.MIGRATING)
      })

      it('should be returned as pending to migrate', async () => {
        const LIMIT = 1000
        const pendingMigrations =
          await UploadsUseCases.getPendingMigrations(LIMIT)
        expect(pendingMigrations).toHaveLength(1)
        expect(pendingMigrations[0].id).toBe(upload.id)
      })

      it('should be able to process the migration and remove the upload', async () => {
        const cid = await BlockstoreUseCases.getUploadCID(upload.id)
        await expect(
          UploadsUseCases.processMigration(upload.id),
        ).resolves.not.toThrow()

        expect(rabbitMock).toHaveBeenCalledWith({
          id: 'tag-upload',
          params: {
            cid: cidToString(cid),
          },
        })

        const node = await nodesRepository.getNode(cidToString(cid))
        expect(node).not.toBeNull()

        const uploadEntry = await uploadsRepository.getUploadEntryById(
          upload.id,
        )
        expect(uploadEntry).toBeNull()

        // Tag the upload
        await UploadsUseCases.tagUpload(cidToString(cid))
        expect(rabbitMock).toHaveBeenCalledWith({
          id: 'publish-nodes',
          params: {
            nodes: expect.arrayContaining([cidToString(cid)]),
          },
        })
      })
    })

    describe('Downloading the file', () => {
      it('should be able to retrieve the file', async () => {
        const { startDownload } = await FilesUseCases.downloadObjectByUser(
          user,
          cid,
        )
        const fileArray = await asyncIterableToPromiseOfArray(
          await startDownload(),
        )
        const fileBuffer = Buffer.concat(fileArray)
        expect(fileBuffer).toEqual(rndBuffer)
      })

      it('should have been added an interaction', async () => {
        const { id } = await SubscriptionsUseCases.getSubscriptionInfo(user)
        const interactions =
          await interactionsRepository.getInteractionsBySubscriptionIdAndTypeInTimeRange(
            id,
            InteractionType.Download,
            new Date(0),
            new Date(),
          )

        expect(interactions).toHaveLength(1)
      })

      it('download cache should be updated', async () => {
        // Wait for the async context to finish
        await new Promise((resolve) => setTimeout(resolve, 300))
        const asyncFromDatabase = await downloadService.fsCache.get(cid)
        expect(asyncFromDatabase).not.toBeNull()
        const fileArrayFromDatabase = await asyncIterableToPromiseOfArray(
          asyncFromDatabase!.data,
        )
        const fileBufferFromDatabase = Buffer.concat(fileArrayFromDatabase)
        expect(fileBufferFromDatabase).toEqual(rndBuffer)

        const asyncFromMemory = memoryDownloadCache.get(cid)
        expect(asyncFromMemory).not.toBeNull()
        const fileArrayFromMemory = await asyncIterableToPromiseOfArray(
          asyncFromMemory!,
        )
        const fileBufferFromMemory = Buffer.concat(fileArrayFromMemory)
        expect(fileBufferFromMemory).toEqual(rndBuffer)
      })
    })

    describe('Object Information', () => {
      const PUBLISH_ON_BLOCK = 100

      it('object information should be initialized', async () => {
        const nodes = await nodesRepository.getNodesByHeadCid(cid)
        const objectInformation = await ObjectUseCases.getObjectInformation(cid)
        expect(objectInformation).not.toBeNull()

        expect(objectInformation?.cid).toBe(cid)
        expect(objectInformation?.owners).toEqual([
          {
            oauthUserId: user.oauthUserId,
            oauthProvider: user.oauthProvider,
            role: OwnerRole.ADMIN,
          },
        ])
        expect(objectInformation?.uploadStatus).toEqual({
          uploadedNodes: 0,
          totalNodes: nodes.length,
          archivedNodes: 0,
          minimumBlockDepth: null,
          maximumBlockDepth: null,
        })
      })

      it('object information should be updated on publishing', async () => {
        // Mocking publishing onchain
        const nodes = await nodesRepository.getNodesByHeadCid(cid)
        const transactionResults = nodes.map((node) =>
          NodesUseCases.setPublishedOn(node.cid, {
            success: true,
            txHash: '0x123',
            status: TransactionStatus.CONFIRMED,
            blockNumber: PUBLISH_ON_BLOCK,
          }),
        )
        await Promise.all(transactionResults)
        // End of mocking

        const objectInformation = await ObjectUseCases.getObjectInformation(cid)
        expect(objectInformation).not.toBeNull()
        expect(objectInformation?.uploadStatus).toEqual({
          uploadedNodes: nodes.length,
          totalNodes: nodes.length,
          archivedNodes: 0,
          minimumBlockDepth: PUBLISH_ON_BLOCK,
          maximumBlockDepth: PUBLISH_ON_BLOCK,
        })
      })

      it('object information should be updated on archiving', async () => {
        // Mocking archiving onchain
        const nodes = await nodesRepository.getNodesByHeadCid(cid)

        await NodesUseCases.processNodeArchived(
          nodes.map((node) => [
            Buffer.from(blake3HashFromCid(stringToCid(node.cid))).toString(
              'hex',
            ),
            1,
            1,
          ]),
        )
      })

      it('metadata should be updated as archived', async () => {
        await ObjectUseCases.checkObjectsArchivalStatus()

        const metadata = await metadataRepository.getMetadata(cid)
        expect(metadata).not.toBeNull()
        expect(metadata?.is_archived).toBe(true)

        expect(memoryDownloadCache.has(cid)).toBe(true)
        expect(downloadService.fsCache.get(cid)).not.toBeNull()
      })
    })
  })
})
