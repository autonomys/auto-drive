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
import { fileProcessingInfoRepository } from '../../../src/infrastructure/repositories/uploads/fileProcessingInfo.js'
import { filePartsRepository } from '../../../src/infrastructure/repositories/uploads/fileParts.js'
import { config } from '../../../src/config.js'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import { NodesUseCases } from '../../../src/core/objects/nodes.js'
import {
  UploadStatus,
  UploadType,
  UserWithOrganization,
} from '@auto-drive/models'
import { BadRequestError } from '../../../src/errors/index.js'
import { UploadCompletionInProgressError } from '../../../src/core/uploads/errors.js'
import { MetadataType } from '@autonomys/auto-dag-data'

/* eslint-disable @typescript-eslint/no-explicit-any */

const CID = 'bafkr6icio4rqi75syx2xkxwmnnnwx3gzmnbjmtnqoydtfcxrjuqvvxxs4u'

const mockUser: UserWithOrganization = {
  oauthProvider: 'google',
  oauthUserId: 'user1',
} as any

// updated_at is deliberately old: a migration re-drive is rate-limited by the
// recovery sweep's staleness window, so the default fixture is one the sweep
// would already be re-driving.
const staleUpdatedAt = new Date(
  Date.now() - config.migrationRecovery.stalenessMs - 1_000,
)

const upload = {
  id: 'upload123',
  root_upload_id: 'upload123',
  type: UploadType.FILE,
  status: UploadStatus.MIGRATING,
  oauth_provider: 'google',
  oauth_user_id: 'user1',
  updated_at: staleUpdatedAt,
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

    // An HttpError, not a bare Error: the caller's fault, not ours. Both flatten
    // to a 500 through handleInternalError today, but the type is what makes this
    // a 4xx for free once that is fixed.
    await expect(
      UploadsUseCases.completeUpload(mockUser, upload.id),
    ).rejects.toBeInstanceOf(BadRequestError)
    await expect(
      UploadsUseCases.completeUpload(mockUser, upload.id),
    ).rejects.toThrow(/is failed/)
    expect(processing).not.toHaveBeenCalled()
  })

  // The status read is not a guard by itself: two overlapping calls both observe
  // PENDING. Only the caller that wins the atomic claim may process the upload.
  it('refuses to process when another call holds the completion claim', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      // First read races the winner; the re-read after losing the claim shows the
      // winner still working.
      .mockResolvedValueOnce({ ...upload, status: UploadStatus.PENDING })
      .mockResolvedValue({ ...upload, status: UploadStatus.COMPLETING })
    const claim = jest
      .spyOn(uploadsRepository, 'claimUploadForCompletion')
      .mockResolvedValue(false)
    const processing = jest
      .spyOn(UploadFileProcessingUseCase, 'completeUploadProcessing')
      .mockResolvedValue(CID as any)

    // A dedicated type, not a generic bad request: the S3 route maps it to a
    // retryable 503 SlowDown, which is unreachable if the failure is opaque.
    await expect(
      UploadsUseCases.completeUpload(mockUser, upload.id),
    ).rejects.toBeInstanceOf(UploadCompletionInProgressError)
    expect(claim).toHaveBeenCalledWith(
      upload.id,
      config.uploads.completionClaimStaleMs,
    )
    expect(processing).not.toHaveBeenCalled()
  })

  // A re-drive is a removeNodeByRootCid plus a full node re-insert, so it is
  // rate-limited to the recovery sweep's window; a client retrying in a loop must
  // not multiply that against a large object.
  it('does not re-drive migration for an upload that just started migrating', async () => {
    jest.spyOn(uploadsRepository, 'getUploadEntryById').mockResolvedValue({
      ...upload,
      updated_at: new Date(),
    })
    jest.spyOn(BlockstoreUseCases, 'getUploadCID').mockResolvedValue(CID as any)
    const publish = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    const result = await UploadsUseCases.completeUpload(mockUser, upload.id)

    expect(result).toBe(CID)
    expect(publish).not.toHaveBeenCalled()
  })

  // Losing the claim is not proof that a completion is still running: the winner
  // can finish everything between our status read and the compare-and-swap. That
  // retry has to get its CID, not a spurious failure.
  it('returns the CID when the claim is lost to a winner that already finished', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValueOnce({ ...upload, status: UploadStatus.PENDING })
      .mockResolvedValue({ ...upload, status: UploadStatus.MIGRATING })
    jest
      .spyOn(uploadsRepository, 'claimUploadForCompletion')
      .mockResolvedValue(false)
    jest.spyOn(BlockstoreUseCases, 'getUploadCID').mockResolvedValue(CID as any)
    const processing = jest
      .spyOn(UploadFileProcessingUseCase, 'completeUploadProcessing')
      .mockResolvedValue(CID as any)
    const publish = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    const result = await UploadsUseCases.completeUpload(mockUser, upload.id)

    expect(result).toBe(CID)
    expect(processing).not.toHaveBeenCalled()
    // No re-drive on this path, unlike the plain already-completed one: the
    // winner reached MIGRATING while this call was in flight, so it has just
    // enqueued the migrate task itself and a re-drive would be a guaranteed
    // duplicate on every concurrent retry.
    expect(publish).not.toHaveBeenCalled()
  })

  it('reports a not-found upload when the claim is lost and the row is gone', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValueOnce({ ...upload, status: UploadStatus.PENDING })
      .mockResolvedValue(null)
    jest
      .spyOn(uploadsRepository, 'claimUploadForCompletion')
      .mockResolvedValue(false)

    await expect(
      UploadsUseCases.completeUpload(mockUser, upload.id),
    ).rejects.toThrow(/Upload not found/)
  })

  // The winner can fail fast (insufficient credits, a gap in the stored parts)
  // and hand the upload back before the loser re-reads it. Nothing holds the
  // claim at that point, so telling the client to "retry once it finishes" would
  // be wrong — take the claim instead.
  it('takes the claim when the winner already released it', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue({ ...upload, status: UploadStatus.PENDING })
    const claim = jest
      .spyOn(uploadsRepository, 'claimUploadForCompletion')
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const processing = jest
      .spyOn(UploadFileProcessingUseCase, 'completeUploadProcessing')
      .mockResolvedValue(CID as any)
    jest
      .spyOn(UploadFileProcessingUseCase, 'handleFileUploadFinalization')
      .mockResolvedValue(CID)
    jest
      .spyOn(uploadsRepository, 'updateUploadEntry')
      .mockImplementation(async (entry) => entry)
    jest.spyOn(EventRouter, 'publish').mockReturnValue()
    jest
      .spyOn(fileProcessingInfoRepository, 'getFileProcessingInfoByUploadId')
      .mockResolvedValue({
        upload_id: upload.id,
        last_processed_part_index: 0,
      } as any)
    jest
      .spyOn(filePartsRepository, 'getChunkByUploadIdAndPartIndex')
      .mockResolvedValue(null as any)
    jest
      .spyOn(filePartsRepository, 'getPartIndicesGreaterThan')
      .mockResolvedValue([])

    const result = await UploadsUseCases.completeUpload(mockUser, upload.id)

    expect(result).toBe(CID)
    expect(claim).toHaveBeenCalledTimes(2)
    expect(processing).toHaveBeenCalledTimes(1)
  })

  // Exactly one re-attempt: a sibling that keeps failing and releasing must not
  // turn the claim path into a loop.
  it('gives up after one re-attempt when the claim keeps being taken', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue({ ...upload, status: UploadStatus.PENDING })
    const claim = jest
      .spyOn(uploadsRepository, 'claimUploadForCompletion')
      .mockResolvedValue(false)
    const processing = jest
      .spyOn(UploadFileProcessingUseCase, 'completeUploadProcessing')
      .mockResolvedValue(CID as any)

    await expect(
      UploadsUseCases.completeUpload(mockUser, upload.id),
    ).rejects.toThrow(/already being completed/)
    expect(claim).toHaveBeenCalledTimes(2)
    expect(processing).not.toHaveBeenCalled()
  })

  it('claims the upload before processing and only then flips it to MIGRATING', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue({ ...upload, status: UploadStatus.PENDING })
    const order: string[] = []
    jest
      .spyOn(uploadsRepository, 'claimUploadForCompletion')
      .mockImplementation(async () => {
        order.push('claim')
        return true
      })
    jest
      .spyOn(UploadFileProcessingUseCase, 'completeUploadProcessing')
      .mockImplementation(async () => {
        order.push('processing')
        return CID as any
      })
    jest
      .spyOn(UploadFileProcessingUseCase, 'handleFileUploadFinalization')
      .mockResolvedValue(CID)
    jest
      .spyOn(uploadsRepository, 'updateUploadEntry')
      .mockImplementation(async (entry) => {
        order.push(`status:${entry.status}`)
        return entry
      })
    jest.spyOn(EventRouter, 'publish').mockReturnValue()
    const release = jest
      .spyOn(uploadsRepository, 'releaseUploadCompletionClaim')
      .mockResolvedValue(undefined)
    // A FILE upload drains its parts first; both helpers read the same cursor.
    jest
      .spyOn(fileProcessingInfoRepository, 'getFileProcessingInfoByUploadId')
      .mockResolvedValue({
        upload_id: upload.id,
        last_processed_part_index: 0,
      } as any)
    jest
      .spyOn(filePartsRepository, 'getChunkByUploadIdAndPartIndex')
      .mockResolvedValue(null as any)
    jest
      .spyOn(filePartsRepository, 'getPartIndicesGreaterThan')
      .mockResolvedValue([])

    const result = await UploadsUseCases.completeUpload(mockUser, upload.id)

    expect(result).toBe(CID)
    // MIGRATING is only reached after the root node exists, so the migration
    // recovery sweep can never select a still-completing upload.
    expect(order).toEqual([
      'claim',
      'processing',
      `status:${UploadStatus.MIGRATING}`,
    ])
    expect(release).not.toHaveBeenCalled()
  })

  // The snapshot read before the compare-and-swap can be stale by the time the
  // claim is won, and finalizeCompletedUpload writes the whole row back — so a
  // stale snapshot would revert whatever a concurrent writer had changed.
  it('processes the row as it stands after the claim, not the pre-claim snapshot', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      // Pre-claim snapshot, then the row as it stands once the claim is held.
      .mockResolvedValueOnce({
        ...upload,
        status: UploadStatus.PENDING,
        mime_type: 'application/octet-stream',
      })
      .mockResolvedValue({
        ...upload,
        status: UploadStatus.COMPLETING,
        mime_type: 'text/plain',
      })
    jest
      .spyOn(uploadsRepository, 'claimUploadForCompletion')
      .mockResolvedValue(true)
    const processing = jest
      .spyOn(UploadFileProcessingUseCase, 'completeUploadProcessing')
      .mockResolvedValue(CID as any)
    jest
      .spyOn(UploadFileProcessingUseCase, 'handleFileUploadFinalization')
      .mockResolvedValue(CID)
    const updateEntry = jest
      .spyOn(uploadsRepository, 'updateUploadEntry')
      .mockImplementation(async (entry) => entry)
    jest.spyOn(EventRouter, 'publish').mockReturnValue()
    jest
      .spyOn(fileProcessingInfoRepository, 'getFileProcessingInfoByUploadId')
      .mockResolvedValue({
        upload_id: upload.id,
        last_processed_part_index: 0,
      } as any)
    jest
      .spyOn(filePartsRepository, 'getChunkByUploadIdAndPartIndex')
      .mockResolvedValue(null as any)
    jest
      .spyOn(filePartsRepository, 'getPartIndicesGreaterThan')
      .mockResolvedValue([])

    await UploadsUseCases.completeUpload(mockUser, upload.id)

    expect(processing).toHaveBeenCalledWith(
      expect.objectContaining({ mime_type: 'text/plain' }),
    )
    // The flip to MIGRATING carries the fresh row forward rather than writing the
    // pre-claim snapshot's fields back over it.
    expect(updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        mime_type: 'text/plain',
        status: UploadStatus.MIGRATING,
      }),
    )
  })

  // A failed completion must hand the upload back: COMPLETING is not swept by
  // migration recovery, so a stranded claim would be invisible.
  it('releases the claim when completion fails so the client can retry', async () => {
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue({ ...upload, status: UploadStatus.PENDING })
    jest
      .spyOn(uploadsRepository, 'claimUploadForCompletion')
      .mockResolvedValue(true)
    jest
      .spyOn(UploadFileProcessingUseCase, 'completeUploadProcessing')
      .mockRejectedValue(new Error('Not enough upload credits'))
    const release = jest
      .spyOn(uploadsRepository, 'releaseUploadCompletionClaim')
      .mockResolvedValue(undefined)
    const updateEntry = jest
      .spyOn(uploadsRepository, 'updateUploadEntry')
      .mockImplementation(async (entry) => entry)
    jest
      .spyOn(fileProcessingInfoRepository, 'getFileProcessingInfoByUploadId')
      .mockResolvedValue({
        upload_id: upload.id,
        last_processed_part_index: 0,
      } as any)
    jest
      .spyOn(filePartsRepository, 'getChunkByUploadIdAndPartIndex')
      .mockResolvedValue(null as any)
    jest
      .spyOn(filePartsRepository, 'getPartIndicesGreaterThan')
      .mockResolvedValue([])

    await expect(
      UploadsUseCases.completeUpload(mockUser, upload.id),
    ).rejects.toThrow(/Not enough upload credits/)
    expect(release).toHaveBeenCalledWith(upload.id)
    expect(updateEntry).not.toHaveBeenCalled()
  })
})

describe('UploadsUseCases.abortUpload with a completion claim', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // A live completion is working, not stranded. Tearing its rows out from under a
  // running DAG build would be worse than making the client wait.
  it('refuses to abort an upload whose completion is still running', async () => {
    jest.spyOn(uploadsRepository, 'getUploadEntryById').mockResolvedValue({
      ...upload,
      status: UploadStatus.COMPLETING,
      updated_at: new Date(),
    })
    const remove = jest
      .spyOn(uploadsRepository, 'deleteEntriesByRootUploadId')
      .mockResolvedValue(undefined)

    const result = await UploadsUseCases.abortUpload(mockUser, upload.id)

    expect(result.isErr()).toBe(true)
    expect(remove).not.toHaveBeenCalled()
  })

  // Once the claim is stale the process that held it is gone. Without this the
  // new COMPLETING state would make a stranded upload un-abortable for a full
  // hour — S3 AbortMultipartUpload answering NoSuchUpload the whole time — where
  // the equivalent stranded PENDING row can be aborted at once.
  it('aborts an upload whose completion claim has gone stale', async () => {
    jest.spyOn(uploadsRepository, 'getUploadEntryById').mockResolvedValue({
      ...upload,
      status: UploadStatus.COMPLETING,
      updated_at: new Date(
        Date.now() - config.uploads.completionClaimStaleMs - 1_000,
      ),
    })
    jest
      .spyOn(uploadsRepository, 'deleteEntriesByRootUploadId')
      .mockResolvedValue(undefined)
    jest
      .spyOn(blockstoreRepository, 'deleteBlockstoreEntries')
      .mockResolvedValue(undefined)
    jest
      .spyOn(filePartsRepository, 'deleteChunksByUploadId')
      .mockResolvedValue(undefined)
    jest
      .spyOn(fileProcessingInfoRepository, 'deleteFileProcessingInfo')
      .mockResolvedValue(undefined)

    const result = await UploadsUseCases.abortUpload(mockUser, upload.id)

    expect(result.isOk()).toBe(true)
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
