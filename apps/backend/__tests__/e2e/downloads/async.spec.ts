import { User, AsyncDownloadStatus, AsyncDownload } from '@auto-drive/models'
import { createMockUser } from '../../utils/mocks.js'
import { AsyncDownloadsUseCases } from '../../../src/core/downloads/index.js'
import { uploadFile } from '../../utils/uploads.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { asyncDownloadsRepository } from '../../../src/infrastructure/repositories/asyncDownloads/index.js'
import { Rabbit } from '../../../src/infrastructure/drivers/rabbit.js'
import { jest } from '@jest/globals'
import { createTask } from '../../../src/infrastructure/eventRouter/tasks.js'
import { ObjectUseCases } from '../../../src/core/index.js'
import { downloadService } from '../../../src/infrastructure/services/download/index.js'
import { Readable } from 'stream'
import {
  ForbiddenError,
  InternalError,
  ObjectNotFoundError,
} from '../../../src/errors/index.js'
import { err } from 'neverthrow'

describe('Async Downloads', () => {
  let user: User
  let cid: string
  // A second object, untouched by the other tests. They all share `cid` and
  // never clean up, so any test that needs to observe a first-ever request for
  // an object needs one of its own. Content-addressed, hence the distinct body.
  let dedupeCid: string

  beforeAll(async () => {
    await dbMigration.up()
    const mockUser = createMockUser()
    user = mockUser
    cid = await uploadFile(mockUser, 'test.txt', 'test', 'text/plain')
    dedupeCid = await uploadFile(
      mockUser,
      'dedupe.txt',
      'dedupe-test-content',
      'text/plain',
    )
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  afterEach(async () => {
    jest.restoreAllMocks()
  })

  it('should fail if object is not found', async () => {
    const result = await AsyncDownloadsUseCases.createDownload(
      user,
      'not-found',
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
  })

  it('should create an async download', async () => {
    const expectedTask = createTask({
      id: 'async-download-created',
      params: {
        downloadId: expect.any(String),
      },
    })
    const mockPublish = jest.spyOn(Rabbit, 'publish').mockResolvedValue()

    const download = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())

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
    const result = await AsyncDownloadsUseCases.asyncDownload('not-found')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
  })

  it('should fail if object is not found', async () => {
    const download = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())
    const mockGetMetadata = jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(err(new ObjectNotFoundError('Object not found')))

    const result = await AsyncDownloadsUseCases.asyncDownload(download.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)

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

    const download = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())
    const doneMock = jest.spyOn(AsyncDownloadsUseCases, 'updateStatus')

    await AsyncDownloadsUseCases.asyncDownload(download.id)

    expect(mockUpdateProgress).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      0n,
    )
    for (let i = 0; i < expectedChunks.length; i++) {
      expect(mockUpdateProgress).toHaveBeenNthCalledWith(
        i + 2,
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

    const download = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())

    const result = await AsyncDownloadsUseCases.asyncDownload(download.id)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(InternalError)
  })

  it('should be dismissed if user dismiss it', async () => {
    const download = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())
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
    const download1 = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())
    const download2 = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())

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

  it('should reuse the in-flight download instead of queueing another', async () => {
    const mockPublish = jest.spyOn(Rabbit, 'publish').mockResolvedValue()

    const first = await AsyncDownloadsUseCases.createDownload(
      user,
      dedupeCid,
    ).then((e) => e._unsafeUnwrap())
    const second = await AsyncDownloadsUseCases.createDownload(
      user,
      dedupeCid,
    ).then((e) => e._unsafeUnwrap())

    // Same row, and crucially only one task: a retrieval runs for minutes, so
    // a user will click again while it works. Before this, every click queued
    // another full pull of the same object against the same gateway.
    expect(second.id).toBe(first.id)
    expect(mockPublish).toHaveBeenCalledTimes(1)

    await AsyncDownloadsUseCases.dismissDownload(user, first.id)
  })

  it('should exclude dismissed downloads and allow a fresh request afterwards', async () => {
    jest.spyOn(Rabbit, 'publish').mockResolvedValue()

    const dismissed = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())
    await AsyncDownloadsUseCases.dismissDownload(user, dismissed.id)

    // A dismissed row is no longer in flight, so asking again starts a new one
    // rather than handing back the row the user just dismissed.
    const fresh = await AsyncDownloadsUseCases.createDownload(user, cid).then(
      (e) => e._unsafeUnwrap(),
    )
    expect(fresh.id).not.toBe(dismissed.id)

    const downloads = await AsyncDownloadsUseCases.getDownloadsByUser(user)
    expect(downloads).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: fresh.id })]),
    )
    expect(downloads).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: dismissed.id })]),
    )

    await AsyncDownloadsUseCases.dismissDownload(user, fresh.id)
  })

  it('should get a specific download by id', async () => {
    // Create a download
    const download = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())

    // Get the download by id
    const retrieveResult = await AsyncDownloadsUseCases.getDownloadById(
      user,
      download.id,
    )

    // Verify the retrieved download matches the created one
    expect(retrieveResult.isOk()).toBe(true)
    expect(retrieveResult._unsafeUnwrap()).toMatchObject({
      id: download.id,
      cid: download.cid,
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
      status: AsyncDownloadStatus.Pending,
    })
  })

  it('should throw error when user tries to access another user download', async () => {
    // Create a download
    const download = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())

    // Create another user
    const anotherUser = createMockUser()
    // Attempt to get the download with another user
    const result = await AsyncDownloadsUseCases.getDownloadById(
      anotherUser,
      download.id,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })
})
