import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { BlockstoreUseCases } from '../../../src/core/uploads/blockstore.js'
import { UploadFileProcessingUseCase } from '../../../src/core/uploads/uploadProcessing.js'
import { UnrecoverableUploadError } from '../../../src/core/uploads/errors.js'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { blockstoreRepository } from '../../../src/infrastructure/repositories/uploads/blockstore.js'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import { NodesUseCases } from '../../../src/core/objects/nodes.js'
import {
  UploadStatus,
  UploadType,
  UserWithOrganization,
} from '@auto-drive/models'
import { MetadataType } from '@autonomys/auto-dag-data'

/* eslint-disable @typescript-eslint/no-explicit-any */

const CID = 'bafkr6icio4rqi75syx2xkxwmnnnwx3gzmnbjmtnqoydtfcxrjuqvvxxs4u'

const mockUser: UserWithOrganization = {
  oauthProvider: 'google',
  oauthUserId: 'user1',
} as any

const upload = {
  id: 'upload123',
  root_upload_id: 'upload123',
  type: UploadType.FILE,
  status: UploadStatus.MIGRATING,
  oauth_provider: 'google',
  oauth_user_id: 'user1',
} as any

const entry = (cid: string) =>
  ({ upload_id: upload.id, cid, node_type: MetadataType.File }) as any

describe('UploadsUseCases.completeUpload idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // The bug that filled frontend-errors: a retried complete call re-ran the
  // completion processing, which re-INSERTed the root node into
  // uploads.blockstore and left the upload permanently unmigratable.
  it('does not re-run completion processing for an already-completed upload', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue(upload)
    jest.spyOn(BlockstoreUseCases, 'getUploadCID').mockResolvedValue(CID as any)
    const processing = jest
      .spyOn(UploadFileProcessingUseCase, 'completeUploadProcessing')
      .mockResolvedValue(CID as any)
    const publish = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    const result = await UploadsUseCases.completeUpload(mockUser, upload.id)

    expect(processing).not.toHaveBeenCalled()
    expect(result).toBe(CID)
    // The repeat call re-drives migration, so a lost one-shot migrate task heals.
    expect(publish).toHaveBeenCalledTimes(1)
    const [tasks] = publish.mock.calls[0] as any
    expect(tasks[0].id).toBe('migrate-upload-nodes')
    expect(tasks[0].params.uploadId).toBe(upload.id)
  })

  it('refuses to complete an upload in a terminal state', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue({ ...upload, status: UploadStatus.FAILED })
    const processing = jest
      .spyOn(UploadFileProcessingUseCase, 'completeUploadProcessing')
      .mockResolvedValue(CID as any)

    await expect(
      UploadsUseCases.completeUpload(mockUser, upload.id),
    ).rejects.toThrow(/is failed/)
    expect(processing).not.toHaveBeenCalled()
  })
})

describe('BlockstoreUseCases root CID resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // Production rows written before the completeUpload guard: byte-identical
  // duplicates of the same root node. Their data is intact, so they must migrate.
  it('accepts duplicate root rows that all carry the same CID', async () => {
    jest
      .spyOn(blockstoreRepository, 'getByType')
      .mockResolvedValue([entry(CID), entry(CID), entry(CID)])

    const cid = await BlockstoreUseCases.getFileUploadIdCID(upload.id)

    expect(cid.toString()).toBe(CID)
  })

  it('rejects genuinely ambiguous root rows as unrecoverable', async () => {
    jest
      .spyOn(blockstoreRepository, 'getByType')
      .mockResolvedValue([
        entry(CID),
        entry('bafkr6ie5s3iyyqjmnwqzuz5rzsnfhpvgvbrhfpwbcnbnqvbcqchbmqvxqm'),
      ])

    await expect(
      BlockstoreUseCases.getFileUploadIdCID(upload.id),
    ).rejects.toBeInstanceOf(UnrecoverableUploadError)
  })

  it('rejects a missing root row as unrecoverable', async () => {
    jest.spyOn(blockstoreRepository, 'getByType').mockResolvedValue([])

    await expect(
      BlockstoreUseCases.getFileUploadIdCID(upload.id),
    ).rejects.toBeInstanceOf(UnrecoverableUploadError)
  })
})

describe('UploadsUseCases.processMigration unrecoverable handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // Without this the task burns its retries, dead-letters into the unconsumed
  // frontend-errors queue, stays MIGRATING, and is re-driven by the recovery
  // sweep every staleness window — growing the queue without bound.
  it('parks the upload as failed and acks instead of retrying forever', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue(upload)
    jest
      .spyOn(BlockstoreUseCases, 'getUploadCID')
      .mockRejectedValue(
        new UnrecoverableUploadError('no root node', upload.id),
      )
    const migrate = jest
      .spyOn(NodesUseCases, 'migrateFromBlockstoreToNodesTable')
      .mockResolvedValue(undefined)
    const setStatus = jest
      .spyOn(uploadsRepository, 'updateUploadStatusByRootUploadId')
      .mockResolvedValue(undefined)

    await expect(
      UploadsUseCases.processMigration(upload.id),
    ).resolves.toBeUndefined()

    expect(setStatus).toHaveBeenCalledWith(upload.id, UploadStatus.FAILED)
    expect(migrate).not.toHaveBeenCalled()
  })

  // A transient failure must still retry — only permanent shapes are parked.
  it('rethrows a transient failure so the task retries', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue(upload)
    jest
      .spyOn(BlockstoreUseCases, 'getUploadCID')
      .mockRejectedValue(new Error('connection terminated unexpectedly'))
    const setStatus = jest
      .spyOn(uploadsRepository, 'updateUploadStatusByRootUploadId')
      .mockResolvedValue(undefined)

    await expect(UploadsUseCases.processMigration(upload.id)).rejects.toThrow(
      /connection terminated/,
    )
    expect(setStatus).not.toHaveBeenCalled()
  })
})
