import {
  cidToString,
  processFileToIPLDFormat,
  processFolderToIPLDFormat,
  stringToCid,
} from '@autonomys/auto-dag-data'
import {
  FolderTreeFolder,
  OwnerRole,
  TransactionStatus,
  FileUpload,
  Upload,
  UploadStatus,
  UploadType,
  UserWithOrganization,
} from '@auto-drive/models'
import { NodesUseCases, ObjectUseCases } from '../../../src/core/index.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { PreconditionError } from '../../utils/error.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { MemoryBlockstore } from 'blockstore-core'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import {
  metadataRepository,
  nodesRepository,
} from '../../../src/infrastructure/repositories/index.js'
import { asyncIterableToPromiseOfArray } from '@autonomys/asynchronous'
import PizZip from 'pizzip'
import { BlockstoreUseCases } from '../../../src/core/uploads/blockstore.js'
import { Rabbit } from '../../../src/infrastructure/drivers/rabbit.js'
import { DownloadUseCase } from '../../../src/core/downloads/index.js'
import { ObjectNotFoundError } from '../../../src/errors/index.js'
import { ok } from 'neverthrow'
import { jest } from '@jest/globals'

describe('Folder Upload', () => {
  let user: UserWithOrganization
  let folderUpload: Upload
  let rabbitMock: jest.SpiedFunction<typeof Rabbit.publish>

  beforeAll(async () => {
    await dbMigration.up()
    user = createMockUser()
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

  const folderName = 'test'
  const folderId = folderName
  const subfileName = 'test.exe'
  const subfileId = subfileName
  const subfileMimeType = 'text/plain'
  const subfileSize = 100
  const subfileBuffer = Buffer.from('t'.repeat(subfileSize))
  const subfolderName = 'test2'

  const fileTree: FolderTreeFolder = {
    name: folderName,
    type: 'folder',
    children: [
      {
        type: 'file',
        name: subfileName,
        id: subfileId,
      },
      {
        type: 'folder',
        name: subfolderName,
        id: subfolderName,
        children: [],
      },
    ],
    id: folderId,
  }
  const totalChildren = fileTree.children.length
  const totalNodes = totalChildren + 1

  // Result of the subfile upload
  let subfileCID: string
  // Result of the folder upload
  let folderCID: string
  // Result of the subfolder upload
  let subfolderCid: string

  describe('Folder upload initialization', () => {
    it('should be able to create a folder upload', async () => {
      folderUpload = await UploadsUseCases.createFolderUpload(
        user,
        folderName,
        fileTree,
        null,
      )

      expect(folderUpload).toMatchObject({
        id: expect.any(String),
        rootId: expect.any(String),
        relativeId: null,
        type: UploadType.FOLDER,
        status: UploadStatus.PENDING,
        name: 'test',
        fileTree,
      })
    })
  })

  describe('File within folder upload', () => {
    let subfileUpload: FileUpload
    it('should be able to create an file upload within a folder upload', async () => {
      subfileUpload = await UploadsUseCases.createFileInFolder(
        user,
        folderUpload.id,
        subfileId,
        subfileName,
        subfileMimeType,
      )

      expect(subfileUpload).toMatchObject({
        id: expect.any(String),
        rootId: folderUpload.id,
        relativeId: subfileId,
        type: UploadType.FILE,
        status: UploadStatus.PENDING,
        name: subfileName,
        mimeType: subfileMimeType,
      })
    })

    it('should be able to upload a file to a file upload', async () => {
      await expect(
        UploadsUseCases.uploadChunk(user, subfileUpload.id, 0, subfileBuffer),
      ).resolves.not.toThrow()
    })

    it('should be able to complete subfile upload with matching CIDs', async () => {
      const expectedCID = cidToString(
        await processFileToIPLDFormat(
          new MemoryBlockstore(),
          [subfileBuffer],
          BigInt(subfileSize),
          subfileName,
        ),
      )

      subfileCID = await UploadsUseCases.completeUpload(user, subfileUpload.id)
      expect(subfileCID).toBe(expectedCID)
    })

    it('should status be updated to completed', async () => {
      const upload = await uploadsRepository.getUploadEntryById(
        subfileUpload.id,
      )
      expect(upload).toBeTruthy()
      expect(upload?.status).toBe(UploadStatus.MIGRATING)
    })

    it('should not be generated any metadata', async () => {
      if (!subfileCID) throw new PreconditionError('Subfile CID not defined')
      const metadata = await ObjectUseCases.getMetadata(subfileCID)
      expect(metadata.isErr()).toBe(true)
      expect(metadata._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })
  })

  describe('Folder upload', () => {
    it('should be able to finalize folder upload', async () => {
      subfolderCid = cidToString(
        await processFolderToIPLDFormat(
          new MemoryBlockstore(),
          [],
          subfolderName,
          BigInt(0),
        ),
      )
      const expectedCID = cidToString(
        await processFolderToIPLDFormat(
          new MemoryBlockstore(),
          [stringToCid(subfileCID), stringToCid(subfolderCid)],
          folderName,
          BigInt(subfileSize),
        ),
      )

      folderCID = await UploadsUseCases.completeUpload(user, folderUpload.id)

      expect(rabbitMock).toHaveBeenCalledWith('task-manager', {
        id: 'migrate-upload-nodes',
        params: {
          uploadId: folderUpload.id,
        },
        retriesLeft: expect.any(Number),
      })

      expect(folderCID).toBe(expectedCID)
    })

    it('should be generated metadata', async () => {
      if (!folderCID) throw new PreconditionError('Folder CID not defined')
      const metadata = await ObjectUseCases.getMetadata(folderCID).then((e) =>
        e._unsafeUnwrap(),
      )
      expect(metadata).toMatchObject({
        dataCid: folderCID,
        type: 'folder',
        totalSize: BigInt(subfileSize).toString(),
        totalFiles: totalChildren,
        children: [
          {
            type: 'file',
            cid: subfileCID,
            totalSize: BigInt(subfileSize).toString(),
          },
          {
            type: 'folder',
            cid: subfolderCid,
            totalSize: BigInt(0).toString(),
          },
        ],
        uploadOptions: {},
      })
    })

    it('should be able to get file metadata', async () => {
      if (!subfileCID) throw new PreconditionError('Subfile CID not defined')
      const metadata = await ObjectUseCases.getMetadata(subfileCID).then((e) =>
        e._unsafeUnwrap(),
      )
      expect(metadata).toMatchObject({
        dataCid: subfileCID,
        type: 'file',
        totalSize: BigInt(subfileSize).toString(),
      })
    })

    it('should uploads status be migrating', async () => {
      if (!subfileCID) throw new PreconditionError('Subfile CID not defined')
      const subfileUpload = await uploadsRepository.getUploadsByRoot(
        folderUpload.id,
      )
      expect(subfileUpload?.length).toBe(totalNodes)
      expect(
        subfileUpload?.every((e) => e.status === UploadStatus.MIGRATING),
      ).toBe(true)

      await new Promise((resolve) => setTimeout(resolve, 1000))
    })

    it('should uploads being migrated', async () => {
      if (!folderCID) throw new PreconditionError('Folder CID not defined')

      const cid = await BlockstoreUseCases.getUploadCID(folderUpload.id)
      await expect(
        UploadsUseCases.processMigration(folderUpload.id),
      ).resolves.not.toThrow()

      expect(rabbitMock).toHaveBeenCalledWith('task-manager', {
        id: 'tag-upload',
        params: {
          cid: cidToString(cid),
        },
        retriesLeft: expect.any(Number),
      })

      const node = await nodesRepository.getNode(cidToString(cid))
      expect(node).not.toBeNull()

      const uploads = await uploadsRepository.getUploadsByRoot(folderUpload.id)
      expect(uploads).toHaveLength(0)
    })

    it('tagging folder should mark subfile as insecure', async () => {
      await UploadsUseCases.tagUpload(folderCID)
      const metadata = await metadataRepository.getMetadata(subfileCID)
      expect(metadata).toMatchObject({
        tags: ['insecure'],
      })

      expect(rabbitMock).toHaveBeenCalledWith('task-manager', {
        id: 'publish-nodes',
        params: {
          nodes: expect.arrayContaining([folderCID, subfileCID, subfolderCid]),
        },
        retriesLeft: expect.any(Number),
      })
    })

    it('upload status should be updated on node publishing', async () => {
      // Mocking node publishing
      const blockNumber = 123
      const nodes = await nodesRepository.getNodesByRootCid(folderCID)
      const promises = nodes.map((e) => {
        NodesUseCases.setPublishedOn(e.cid, {
          success: true,
          txHash: '0x123',
          status: TransactionStatus.CONFIRMED,
          blockNumber,
        })
      })

      await Promise.all(promises)
      // End of mocking

      const objectInformation =
        await ObjectUseCases.getObjectInformation(folderCID)
      expect(objectInformation).toMatchObject({
        uploadState: {
          totalNodes: totalNodes,
          uploadedNodes: totalNodes,
          archivedNodes: 0,
          minimumBlockDepth: blockNumber,
          maximumBlockDepth: blockNumber,
        },
      })
    })

    it('upload status should be updated when archived', async () => {
      const nodes = await nodesRepository.getNodesByRootCid(folderCID)
      const promises = nodes.map((e) => {
        return nodesRepository.setNodeArchivingData({
          cid: e.cid,
          pieceIndex: 1,
          pieceOffset: 1,
        })
      })

      await Promise.all(promises)

      const objectInformation =
        await ObjectUseCases.getObjectInformation(folderCID)
      expect(objectInformation).toMatchObject({
        uploadState: {
          totalNodes,
          uploadedNodes: totalNodes,
          archivedNodes: totalNodes,
          minimumBlockDepth: expect.any(Number),
          maximumBlockDepth: expect.any(Number),
        },
      })
    })

    it('should be able to get object summary', async () => {
      const summary = await ObjectUseCases.getObjectSummaryByCID(folderCID)
      expect(summary).toMatchObject({
        headCid: folderCID,
        name: folderName,
        type: 'folder',
        size: BigInt(subfileSize).toString(),
        owners: [
          {
            role: OwnerRole.ADMIN,
            oauthUserId: user.oauthUserId,
            oauthProvider: user.oauthProvider,
          },
        ],
      })
    })

    it('should be able to download folder as zip', async () => {
      jest.spyOn(ObjectUseCases, 'authorizeDownload').mockResolvedValue(ok())
      const downloadResult = await DownloadUseCase.downloadObjectByUser(
        user,
        folderCID,
      )
      if (downloadResult.isErr()) {
        throw downloadResult.error
      }
      const dataStream = await downloadResult.value.startDownload()
      const zipArray = await asyncIterableToPromiseOfArray(dataStream)
      const zipBuffer = Buffer.concat(zipArray)
      expect(zipBuffer).toBeDefined()
      expect(() => {
        new PizZip(zipBuffer)
      }).not.toThrow()
    })
  })
})
