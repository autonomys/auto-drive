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
import { memoryDownloadCache } from '../../../src/infrastructure/services/download/memoryDownloadCache/index.js'
import { FileGatewayObjectFetcher } from '../../../src/core/objects/files/fetchers.js'
import { PassThrough, Readable } from 'stream'
import {
  ForbiddenError,
  InternalError,
  ObjectNotFoundError,
} from '../../../src/errors/index.js'
import { err } from 'neverthrow'

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

  it('should not list dismissed downloads', async () => {
    const download1 = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())
    await AsyncDownloadsUseCases.dismissDownload(user, download1.id)
    const download2 = await AsyncDownloadsUseCases.createDownload(
      user,
      cid,
    ).then((e) => e._unsafeUnwrap())

    const downloads = await AsyncDownloadsUseCases.getDownloadsByUser(user)

    expect(downloads).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: download2.id })]),
    )
    expect(downloads).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: download1.id })]),
    )
  })

  it('returns the download the caller already has in progress instead of queueing another', async () => {
    const caller = createMockUser()
    const publish = jest.spyOn(Rabbit, 'publish').mockResolvedValue()

    const first = await AsyncDownloadsUseCases.createDownload(caller, cid).then(
      (e) => e._unsafeUnwrap(),
    )
    const again = await AsyncDownloadsUseCases.createDownload(caller, cid).then(
      (e) => e._unsafeUnwrap(),
    )

    expect(again.id).toBe(first.id)
    expect(publish).toHaveBeenCalledTimes(1)

    await asyncDownloadsRepository.updateDownloadStatus(
      first.id,
      AsyncDownloadStatus.Downloading,
    )
    const whileDownloading = await AsyncDownloadsUseCases.createDownload(
      caller,
      cid,
    ).then((e) => e._unsafeUnwrap())

    expect(whileDownloading.id).toBe(first.id)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it.each([AsyncDownloadStatus.Completed, AsyncDownloadStatus.Failed])(
    'creates a new download once the previous one is %s',
    async (status) => {
      const caller = createMockUser()
      const publish = jest.spyOn(Rabbit, 'publish').mockResolvedValue()

      const previous = await AsyncDownloadsUseCases.createDownload(
        caller,
        cid,
      ).then((e) => e._unsafeUnwrap())
      await asyncDownloadsRepository.updateDownloadStatus(previous.id, status)

      const next = await AsyncDownloadsUseCases.createDownload(
        caller,
        cid,
      ).then((e) => e._unsafeUnwrap())

      expect(next.id).not.toBe(previous.id)
      expect(next.status).toBe(AsyncDownloadStatus.Pending)
      expect(publish).toHaveBeenCalledTimes(2)
    },
  )

  it('does not reuse a download of another user', async () => {
    const owner = createMockUser()
    const other = createMockUser()
    jest.spyOn(Rabbit, 'publish').mockResolvedValue()

    const ownerDownload = await AsyncDownloadsUseCases.createDownload(
      owner,
      cid,
    ).then((e) => e._unsafeUnwrap())
    const otherDownload = await AsyncDownloadsUseCases.createDownload(
      other,
      cid,
    ).then((e) => e._unsafeUnwrap())

    expect(otherDownload.id).not.toBe(ownerDownload.id)
    expect(otherDownload.oauthUserId).toBe(other.oauthUserId)
  })

  it('serves repeat clicks, other users and previews of an uncached archived object from one gateway retrieval', async () => {
    const content = Buffer.from('archived object content')
    const archivedCid = await uploadFile(
      createMockUser(),
      'archived.txt',
      content,
      'text/plain',
    )
    await memoryDownloadCache.clear()
    await downloadService.fsCache.remove(archivedCid)

    jest.spyOn(Rabbit, 'publish').mockResolvedValue()
    jest.spyOn(ObjectUseCases, 'isArchived').mockResolvedValue(true)
    // Reads go to the gateway only once the local node data has been reclaimed
    jest.spyOn(ObjectUseCases, 'hasAllNodeData').mockResolvedValue(false)
    const gateway = new PassThrough()
    const sources: Readable[] = [gateway]
    const gatewayFetch = jest
      .spyOn(FileGatewayObjectFetcher, 'fetchFile')
      .mockImplementation(
        async () => sources.shift() ?? Readable.from([content]),
      )
    const fsGet = jest.spyOn(downloadService.fsCache, 'get')

    const firstUser = createMockUser()
    const secondUser = createMockUser()
    const firstJob = await AsyncDownloadsUseCases.createDownload(
      firstUser,
      archivedCid,
    ).then((e) => e._unsafeUnwrap())
    const repeatClick = await AsyncDownloadsUseCases.createDownload(
      firstUser,
      archivedCid,
    ).then((e) => e._unsafeUnwrap())
    const secondJob = await AsyncDownloadsUseCases.createDownload(
      secondUser,
      archivedCid,
    ).then((e) => e._unsafeUnwrap())
    expect(repeatClick.id).toBe(firstJob.id)

    // A preview starts the retrieval, then gives up long before it finishes.
    const preview = await downloadService.download(archivedCid)
    preview.destroy()
    const jobs = Promise.all([
      AsyncDownloadsUseCases.asyncDownload(firstJob.id),
      AsyncDownloadsUseCases.asyncDownload(secondJob.id),
    ])
    const reopenedPreview = downloadService.download(archivedCid)

    // Hold the gateway response until every request has looked in the caches.
    const deadline = Date.now() + 10_000
    while (fsGet.mock.calls.length < 4 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await Promise.allSettled(fsGet.mock.results.map((r) => r.value))
    await new Promise((resolve) => setImmediate(resolve))
    gateway.end(content)

    const results = await jobs
    expect(results.every((result) => result.isOk())).toBe(true)
    expect(Buffer.concat(await (await reopenedPreview).toArray())).toEqual(
      content,
    )
    for (const job of [firstJob, secondJob]) {
      const stored = await asyncDownloadsRepository.getDownloadById(job.id)
      expect(stored?.status).toBe(AsyncDownloadStatus.Completed)
      expect(stored?.downloadedBytes).toBe(content.length.toString())
    }
    expect(gatewayFetch).toHaveBeenCalledTimes(1)
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
