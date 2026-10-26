import { jest } from '@jest/globals'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { DownloadUseCase } from '../../../src/core/downloads/index.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import {
  NotAcceptableError,
  ObjectNotFoundError,
} from '../../../src/errors/index.js'
import { err, ok } from 'neverthrow'
import { createMockUser } from '../../utils/mocks.js'

jest.unstable_mockModule('../../../src/core/objects/object.js', () => ({
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

    jest.spyOn(ObjectUseCases, 'getMetadata').mockResolvedValue(ok(metadata))
    jest.spyOn(ObjectUseCases, 'authorizeDownload').mockResolvedValue(ok())

    const result = await DownloadUseCase.downloadObjectByAnonymous(
      metadata.dataCid,
    )
    if (result.isErr()) {
      throw result.error
    }

    // Expect not to throw
    expect(result.value.metadata).toMatchObject({
      type: metadata.type,
    })
  })

  it('should block file upload', async () => {
    const mockFile = {
      cid: 'test-cid',
      type: 'file',
    }

    jest.spyOn(ObjectUseCases, 'getMetadata').mockResolvedValue(
      ok({
        totalSize: 100n,
        type: 'file',
        dataCid: 'test-cid',
        totalChunks: 1,
        chunks: [],
      }),
    )
    jest
      .spyOn(ObjectUseCases, 'authorizeDownload')
      .mockResolvedValue(err(new NotAcceptableError('File is blocked')))

    const result = await DownloadUseCase.downloadObjectByAnonymous(
      mockFile.cid,
      {
        blockingTags: ['insecure'],
      },
    )

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotAcceptableError)
  })

  describe('downloadObjectByUser', () => {
    const user = createMockUser()

    const metadata: OffchainMetadata = {
      totalSize: 200n * 1024n * 1024n, // 200 MiB — above anonymous limit
      type: 'file',
      dataCid: 'user-test-cid',
      totalChunks: 1,
      chunks: [],
    }

    it('should allow download when metadata is found and access is authorized', async () => {
      jest.spyOn(ObjectUseCases, 'getMetadata').mockResolvedValue(ok(metadata))
      jest.spyOn(ObjectUseCases, 'authorizeDownload').mockResolvedValue(ok())

      const result = await DownloadUseCase.downloadObjectByUser(
        user,
        metadata.dataCid,
      )

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().metadata).toMatchObject({ type: 'file' })
    })

    it('should return ObjectNotFoundError when metadata lookup fails', async () => {
      jest
        .spyOn(ObjectUseCases, 'getMetadata')
        .mockResolvedValue(err(new ObjectNotFoundError('not found')))

      const result = await DownloadUseCase.downloadObjectByUser(
        user,
        'missing-cid',
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('should return NotAcceptableError when file is blocked', async () => {
      jest.spyOn(ObjectUseCases, 'getMetadata').mockResolvedValue(ok(metadata))
      jest
        .spyOn(ObjectUseCases, 'authorizeDownload')
        .mockResolvedValue(err(new NotAcceptableError('blocked')))

      const result = await DownloadUseCase.downloadObjectByUser(
        user,
        metadata.dataCid,
        { blockingTags: ['insecure'] },
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotAcceptableError)
    })

    it('should NOT check download credits — exhausted quota must not block authenticated users', async () => {
      // Simulates a user whose free download quota is fully spent (pendingDownloadCredits < 0).
      // The credit check is intentionally disabled until purchased download bytes
      // are wired up; verifying getPendingCreditsByUserAndType is never called
      // ensures the gate stays open.
      const creditSpy = jest.spyOn(
        AccountsUseCases,
        'getPendingCreditsByUserAndType',
      )

      jest.spyOn(ObjectUseCases, 'getMetadata').mockResolvedValue(ok(metadata))
      jest.spyOn(ObjectUseCases, 'authorizeDownload').mockResolvedValue(ok())

      const result = await DownloadUseCase.downloadObjectByUser(
        user,
        metadata.dataCid,
      )

      expect(result.isOk()).toBe(true)
      expect(creditSpy).not.toHaveBeenCalled()
    })
  })
})
