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
} from '../../../src/models/objects'
import {
  FileUpload,
  Upload,
  UploadStatus,
  UploadType,
} from '../../../src/models/uploads/upload'
import { User } from '../../../src/models/users'
import {
  FilesUseCases,
  ObjectUseCases,
  TransactionResultsUseCases,
  UsersUseCases,
} from '../../../src/useCases'
import { UploadsUseCases } from '../../../src/useCases/uploads/uploads'
import { dbMigration } from '../../utils/dbMigrate'
import { PreconditionError } from '../../utils/error'
import { MOCK_UNONBOARDED_USER } from '../../utils/mocks'
import { MemoryBlockstore } from 'blockstore-core'
import { uploadsRepository } from '../../../src/repositories/uploads/uploads'
import { nodesRepository } from '../../../src/repositories'
import { asyncIterableToPromiseOfArray } from '../../../src/utils/async'
import PizZip from 'pizzip'

describe('Folder Upload', () => {
  let user: User
  let folderUpload: Upload

  beforeAll(async () => {
    await dbMigration.up()
    const result = await UsersUseCases.onboardUser(MOCK_UNONBOARDED_USER)
    if (!result) throw new PreconditionError('Failed to setup test user')
    user = result
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  const folderName = 'test'
  const folderId = folderName
  const subfileName = 'test.txt'
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
      expect(metadata).toBeUndefined()
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
      expect(folderCID).toBe(expectedCID)
    })

    it('should be generated metadata', async () => {
      if (!folderCID) throw new PreconditionError('Folder CID not defined')
      const metadata = await ObjectUseCases.getMetadata(folderCID)
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
      const metadata = await ObjectUseCases.getMetadata(subfileCID)
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

      await expect(
        UploadsUseCases.processMigration(folderUpload.id),
      ).resolves.not.toThrow()

      const uploads = await uploadsRepository.getUploadsByRoot(folderUpload.id)
      expect(uploads?.length).toBe(totalNodes)
      expect(uploads?.every((e) => e.status === UploadStatus.COMPLETED)).toBe(
        true,
      )
    })

    it('upload status should be updated on node publishing', async () => {
      // Mocking node publishing
      const blockNumber = 123
      const nodes = await nodesRepository.getNodesByRootCid(folderCID)
      const promises = nodes.map((e) => {
        TransactionResultsUseCases.setTransactionResults(e.cid, {
          success: true,
          batchTxHash: '0x123',
          status: TransactionStatus.CONFIRMED,
          blockNumber,
          blockHash: '0x123',
        })
      })

      await Promise.all(promises)
      // End of mocking

      const objectInformation =
        await ObjectUseCases.getObjectInformation(folderCID)
      expect(objectInformation).toMatchObject({
        uploadStatus: {
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
        uploadStatus: {
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
            publicId: user.publicId,
          },
        ],
      })
    })

    it('should be able to download folder as zip', async () => {
      const zip = await FilesUseCases.downloadObject(user, folderCID)
      const zipArray = await asyncIterableToPromiseOfArray(zip)
      const zipBuffer = Buffer.concat(zipArray)
      expect(zipBuffer).toBeDefined()
      expect(() => {
        new PizZip(zipBuffer)
      }).not.toThrow()
    })
  })
})
