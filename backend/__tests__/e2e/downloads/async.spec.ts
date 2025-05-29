import { User, AsyncDownloadStatus, AsyncDownload } from '@auto-drive/models'
import { createMockUser } from '../../utils/mocks.js'
import { AsyncDownloadsUseCases } from '../../../src/useCases/asyncDownloads/index.js'
import { uploadFile } from '../../utils/uploads.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { asyncDownloadsRepository } from '../../../src/repositories/asyncDownloads/index.js'
import { Rabbit } from '../../../src/drivers/rabbit.js'
import { jest } from '@jest/globals'
import { createTask } from '../../../src/services/eventRouter/tasks.js'
import { ObjectUseCases } from '../../../src/useCases/index.js'
import { downloadService } from '../../../src/services/download/index.js'
import { Readable } from 'stream'

describe('Async Downloads', () => {
  let user: User
  let cid: string

  beforeAll(async () => {
    await dbMigration.up()
    const mockUser = createMockUser()
    user = mockUser
    cid = await uploadFile(mockUser, 'test.txt', 'test', 'text/plain')
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  afterEach(async () => {
    jest.restoreAllMocks()
  })

  it('should fail if object is not found', async () => {
    await expect(
      AsyncDownloadsUseCases.createDownload(user, 'not-found'),
    ).rejects.toThrow('Object not found')
  })

  it('should create an async download', async () => {
    const expectedTask = createTask({
      id: 'async-download-created',
      params: {
        downloadId: expect.any(String),
      },
    })
    const mockPublish = jest.spyOn(Rabbit, 'publish').mockResolvedValue()

    const download = await AsyncDownloadsUseCases.createDownload(user, cid)

    expect(download).toMatchObject({
      id: expect.any(String),
      status: AsyncDownloadStatus.Pending,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
      cid,
      errorMessage: null,
      downloadedBytes: '0',
      fileSize: '4',
    } as AsyncDownload)

    expect(mockPublish).toHaveBeenCalledWith('download-manager', expectedTask)
  })

  it('should fail if download is not found', async () => {
    await expect(
      AsyncDownloadsUseCases.asyncDownload('not-found'),
    ).rejects.toThrow('Download not found')
  })

  it('should fail if object is not found', async () => {
    const download = await AsyncDownloadsUseCases.createDownload(user, cid)
    const mockGetMetadata = jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(undefined)

    await expect(
      AsyncDownloadsUseCases.asyncDownload(download.id),
    ).rejects.toThrow('Object not found')

    mockGetMetadata.mockRestore()
  })

  it('should handle successful download ', async () => {
    const expectedChunks = Array.from({ length: 2 }, () => Buffer.from('test'))

    jest.spyOn(Rabbit, 'publish').mockResolvedValue()

    const mockUpdateProgress = jest.spyOn(
      AsyncDownloadsUseCases,
      'updateProgress',
    )

    const mockDownload = jest.spyOn(downloadService, 'download')
    mockDownload.mockResolvedValue(
      new Readable({
        async read() {
          for (const chunk of expectedChunks) {
            this.push(chunk)
          }
          this.push(null)
        },
      }),
    )

    const download = await AsyncDownloadsUseCases.createDownload(user, cid)
    const doneMock = jest.spyOn(AsyncDownloadsUseCases, 'updateStatus')

    await AsyncDownloadsUseCases.asyncDownload(download.id)

    for (let i = 0; i < expectedChunks.length; i++) {
      expect(mockUpdateProgress).toHaveBeenNthCalledWith(
        i + 1,
        expect.any(String),
        BigInt(i + 1) * 4n,
      )
    }

    expect(doneMock).toHaveBeenCalledWith(
      download.id,
      AsyncDownloadStatus.Completed,
    )
  })

  it('should fail if download fails', async () => {
    const error = new Error('Download failed')
    jest.spyOn(downloadService, 'download').mockResolvedValue(
      new Readable({
        read() {
          this.emit('error', error)
        },
      }),
    )

    const download = await AsyncDownloadsUseCases.createDownload(user, cid)
    const doneMock = jest.spyOn(AsyncDownloadsUseCases, 'setError')

    await expect(
      AsyncDownloadsUseCases.asyncDownload(download.id),
    ).rejects.toThrow('Download failed')

    expect(doneMock).toHaveBeenCalledWith(download.id, expect.any(String))
  })

  it('should be dismissed if user dismiss it', async () => {
    const download = await AsyncDownloadsUseCases.createDownload(user, cid)
    await AsyncDownloadsUseCases.dismissDownload(user, download.id)

    const dismissed = await asyncDownloadsRepository.getDownloadById(
      download.id,
    )

    expect(dismissed).toMatchObject({
      id: download.id,
      status: AsyncDownloadStatus.Dismissed,
    } as AsyncDownload)
  })

  it('should get all downloads for a user', async () => {
    // Create multiple downloads for the same user
    const download1 = await AsyncDownloadsUseCases.createDownload(user, cid)
    const download2 = await AsyncDownloadsUseCases.createDownload(user, cid)

    // Get all downloads for the user
    const downloads = await AsyncDownloadsUseCases.getDownloadsByUser(user)

    // Verify that the downloads include the ones we just created
    expect(downloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: download1.id }),
        expect.objectContaining({ id: download2.id }),
      ]),
    )
  })

  it('should get all downloads for a user', async () => {
    // Create multiple downloads for the same user
    const download1 = await AsyncDownloadsUseCases.createDownload(user, cid)
    const download2 = await AsyncDownloadsUseCases.createDownload(user, cid)

    await AsyncDownloadsUseCases.dismissDownload(user, download1.id)

    // Get all downloads for the user
    const downloads = await AsyncDownloadsUseCases.getDownloadsByUser(user)

    // Verify that the downloads include the ones we just created
    expect(downloads).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: download2.id })]),
    )
  })

  it('should get a specific download by id', async () => {
    // Create a download
    const download = await AsyncDownloadsUseCases.createDownload(user, cid)

    // Get the download by id
    const retrievedDownload = await AsyncDownloadsUseCases.getDownloadById(
      user,
      download.id,
    )

    // Verify the retrieved download matches the created one
    expect(retrievedDownload).toMatchObject({
      id: download.id,
      cid: download.cid,
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
      status: AsyncDownloadStatus.Pending,
    })
  })

  it('should throw error when getting download with invalid id', async () => {
    // Attempt to get a download with an invalid id
    await expect(
      AsyncDownloadsUseCases.getDownloadById(user, 'invalid-id'),
    ).rejects.toThrow('Download not found')
  })

  it('should throw error when user tries to access another user download', async () => {
    // Create a download
    const download = await AsyncDownloadsUseCases.createDownload(user, cid)

    // Create another user
    const anotherUser = createMockUser()
    // Attempt to get the download with another user
    await expect(
      AsyncDownloadsUseCases.getDownloadById(anotherUser, download.id),
    ).rejects.toThrow('User unauthorized')
  })
})
