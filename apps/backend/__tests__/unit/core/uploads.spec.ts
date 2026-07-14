import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { blockstoreRepository } from '../../../src/infrastructure/repositories/uploads/blockstore.js'
import { filePartsRepository } from '../../../src/infrastructure/repositories/uploads/fileParts.js'
import { fileProcessingInfoRepository } from '../../../src/infrastructure/repositories/uploads/fileProcessingInfo.js'
import { UploadStatus, UserWithOrganization } from '@auto-drive/models'
import { ForbiddenError, ObjectNotFoundError } from '../../../src/errors/index.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('UploadsUseCases.abortUpload', () => {
  const mockUser: UserWithOrganization = {
    oauthProvider: 'google',
    oauthUserId: 'user1',
  } as any

  // A standalone file upload still accepting parts (its own root).
  const pendingUpload = {
    id: 'upload123',
    root_upload_id: 'upload123',
    status: UploadStatus.PENDING,
    oauth_provider: 'google',
    oauth_user_id: 'user1',
  } as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // Spies on the four teardown calls removeUploadArtifacts makes.
  const spyArtifactDeletes = () => ({
    blockstore: jest
      .spyOn(blockstoreRepository, 'deleteBlockstoreEntries')
      .mockResolvedValue(undefined as any),
    uploads: jest
      .spyOn(uploadsRepository, 'deleteEntriesByRootUploadId')
      .mockResolvedValue(undefined as any),
    parts: jest
      .spyOn(filePartsRepository, 'deleteChunksByUploadId')
      .mockResolvedValue(undefined as any),
    procInfo: jest
      .spyOn(fileProcessingInfoRepository, 'deleteFileProcessingInfo')
      .mockResolvedValue(undefined as any),
  })

  it('aborts a PENDING upload and tears down its artifacts', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue(pendingUpload)
    const spies = spyArtifactDeletes()

    const result = await UploadsUseCases.abortUpload(mockUser, 'upload123')

    expect(result.isOk()).toBe(true)
    expect(spies.blockstore).toHaveBeenCalledWith('upload123')
    expect(spies.uploads).toHaveBeenCalledWith('upload123')
  })

  it('returns NoSuchUpload for an unknown upload id', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue(null as any)

    const result = await UploadsUseCases.abortUpload(mockUser, 'nope')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
  })

  it('rejects a cross-user abort with Forbidden', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue({ ...pendingUpload, oauth_user_id: 'someone-else' })

    const result = await UploadsUseCases.abortUpload(mockUser, 'upload123')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  // The critical guard: an Abort issued after CompleteMultipartUpload (row is
  // MIGRATING) must NOT tear down the blockstore the migrate-upload-nodes worker
  // still needs — otherwise the client holds a CID whose nodes never publish.
  it('refuses to abort a completed (MIGRATING) upload and deletes nothing', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue({ ...pendingUpload, status: UploadStatus.MIGRATING })
    const spies = spyArtifactDeletes()

    const result = await UploadsUseCases.abortUpload(mockUser, 'upload123')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    expect(spies.blockstore).not.toHaveBeenCalled()
    expect(spies.uploads).not.toHaveBeenCalled()
    expect(spies.parts).not.toHaveBeenCalled()
    expect(spies.procInfo).not.toHaveBeenCalled()
  })
})
