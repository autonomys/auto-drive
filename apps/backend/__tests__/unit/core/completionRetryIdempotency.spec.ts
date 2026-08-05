import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import {
  DEFAULT_MAX_CHUNK_SIZE,
  MetadataType,
  cidToString,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { UploadType } from '@auto-drive/models'
import { err, ok } from 'neverthrow'
import { UploadFileProcessingUseCase } from '../../../src/core/uploads/uploadProcessing.js'
import {
  UnrecoverableUploadError,
  UploadPartsChangedError,
} from '../../../src/core/uploads/errors.js'
import { BlockstoreUseCases } from '../../../src/core/uploads/blockstore.js'
import { ObjectNotFoundError } from '../../../src/errors/index.js'
import {
  NodesUseCases,
  createNodeDeduplicator,
} from '../../../src/core/objects/nodes.js'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { blockstoreRepository } from '../../../src/infrastructure/repositories/uploads/blockstore.js'
import { fileProcessingInfoRepository } from '../../../src/infrastructure/repositories/uploads/fileProcessingInfo.js'
import { filePartsRepository } from '../../../src/infrastructure/repositories/uploads/fileParts.js'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { nodesRepository } from '../../../src/infrastructure/repositories/objects/nodes.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

const UPLOAD_ID = 'upload-retry-1'
const ROOT_CID = 'bafkr6icio4rqi75syx2xkxwmnnnwx3gzmnbjmtnqoydtfcxrjuqvvxxs4u'

// The root node types are the ones blockstore_root_node_unique_idx covers.
const ROOT_NODE_TYPES = [MetadataType.File, MetadataType.Folder]

/**
 * In-memory stand-in for uploads.blockstore that reproduces the SQL semantics
 * the code depends on: rows ordered by an ascending surrogate key, duplicates
 * permitted for chunk rows, and ON CONFLICT DO NOTHING against the partial
 * unique index on the root node types.
 *
 * Faking at the repository layer rather than the blockstore layer keeps the real
 * MultiUploadBlockstore in the test, so the DAG is built by the same code that
 * builds it in production.
 */
const installFakeBlockstore = () => {
  const rows: Array<{
    sort_id: number
    upload_id: string
    cid: string
    node_type: MetadataType
    node_size: bigint
    data: Buffer
  }> = []
  let nextSortId = 1

  jest
    .spyOn(blockstoreRepository, 'addBlockstoreEntry')
    .mockImplementation(async (uploadId, cid, nodeType, nodeSize, data) => {
      const violatesRootUnique =
        ROOT_NODE_TYPES.includes(nodeType) &&
        rows.some((r) => r.upload_id === uploadId && r.cid === cid)
      if (violatesRootUnique) return

      rows.push({
        sort_id: nextSortId++,
        upload_id: uploadId,
        cid,
        node_type: nodeType,
        node_size: nodeSize,
        data,
      })
    })

  const byUpload = (uploadId: string) =>
    rows
      .filter((r) => r.upload_id === uploadId)
      .sort((a, b) => a.sort_id - b.sort_id)

  jest
    .spyOn(blockstoreRepository, 'getByType')
    .mockImplementation(async (uploadId, nodeType) =>
      byUpload(uploadId).filter((r) => r.node_type === nodeType).map(
        (r) => ({ ...r, node_size: r.node_size.toString() }) as any,
      ),
    )

  jest
    .spyOn(blockstoreRepository, 'getByCid')
    .mockImplementation(
      async (uploadId, cid) =>
        (byUpload(uploadId)
          .filter((r) => r.cid === cid)
          .map((r) => ({ ...r, node_size: r.node_size.toString() }))
          .at(0) as any) ?? null,
    )

  jest
    .spyOn(blockstoreRepository, 'getByCIDWithoutData')
    .mockImplementation(
      async (uploadId, cid) =>
        (byUpload(uploadId)
          .filter((r) => r.cid === cid)
          .map((r) => ({ ...r, node_size: r.node_size.toString() }))
          .at(0) as any) ?? null,
    )

  jest
    .spyOn(blockstoreRepository, 'getBlockstoreEntriesWithoutData')
    .mockImplementation(
      async (uploadId) =>
        byUpload(uploadId).map(
          (r) => ({ ...r, node_size: r.node_size.toString() }) as any,
        ),
    )

  // The DAG builder deletes nodes it has folded into a parent. Mirrors the SQL,
  // which deletes every row for that (upload_id, cid) — not just one.
  jest
    .spyOn(blockstoreRepository, 'deleteBlockstoreEntry')
    .mockImplementation(async (uploadId, cid) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].upload_id === uploadId && rows[i].cid === cid) {
          rows.splice(i, 1)
        }
      }
    })

  return {
    rows,
    countOf: (nodeType: MetadataType) =>
      rows.filter((r) => r.node_type === nodeType).length,
    distinctCidsOf: (nodeType: MetadataType) =>
      new Set(rows.filter((r) => r.node_type === nodeType).map((r) => r.cid))
        .size,
  }
}

describe('completeUploadProcessing retry idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // The claim is released back to PENDING when completion FAILS, and the
  // documented failure (`Not enough upload credits`) is thrown by
  // handleFileUploadFinalization strictly AFTER the root node has been written.
  // So the "top up and retry" flow re-enters here — and used to re-put the tail
  // chunk that pending_bytes still held, gaining an extra DAG link and deriving a
  // DIFFERENT root CID. Two distinct root CIDs is the unrecoverable shape:
  // getRootNodeCID refuses it and every later retry appends another root row.
  it('derives the same root CID when completion is retried after a failure', async () => {
    const store = installFakeBlockstore()

    // A tail that never filled a chunk, i.e. pending_bytes is set at completion.
    const pendingBytes = Buffer.from('the unflushed tail of the last part')
    let storedInfo: any = {
      upload_id: UPLOAD_ID,
      last_processed_part_index: 0,
      pending_bytes: pendingBytes,
      created_at: new Date(),
      updated_at: new Date(),
    }

    jest
      .spyOn(fileProcessingInfoRepository, 'getFileProcessingInfoByUploadId')
      .mockImplementation(async () => storedInfo)
    const updateInfo = jest
      .spyOn(fileProcessingInfoRepository, 'updateFileProcessingInfo')
      .mockImplementation(async (info) => {
        storedInfo = { ...info }
        return storedInfo
      })
    jest
      .spyOn(filePartsRepository, 'getUploadFilePartsSize')
      .mockResolvedValue(BigInt(pendingBytes.byteLength))
    jest.spyOn(uploadsRepository, 'getUploadEntryById').mockResolvedValue({
      id: UPLOAD_ID,
      root_upload_id: UPLOAD_ID,
      type: UploadType.FILE,
      name: 'tail.txt',
      upload_options: null,
    } as any)

    const upload = { id: UPLOAD_ID, type: UploadType.FILE } as any

    const firstCid = await UploadFileProcessingUseCase.completeUploadProcessing(
      upload,
    )
    // The tail is consumed, so a retry cannot flush it a second time.
    expect(updateInfo).toHaveBeenCalledWith(
      expect.objectContaining({ pending_bytes: null }),
    )
    expect(storedInfo.pending_bytes).toBeNull()

    // The reason re-derivation cannot be allowed: the chunker consumed the chunk
    // it folded into the root (get -> delete -> put). There is nothing left to
    // rebuild the same DAG from, so a second derivation would produce a root over
    // a different link set — a different CID, which is the unrecoverable shape.
    expect(store.countOf(MetadataType.FileChunk)).toBe(0)

    // Simulates the retry after `Not enough upload credits`.
    const secondCid = await UploadFileProcessingUseCase.completeUploadProcessing(
      upload,
    )

    expect(cidToString(secondCid)).toBe(cidToString(firstCid))
    // Exactly one root row, and one root CID — the shape getRootNodeCID accepts.
    expect(store.countOf(MetadataType.File)).toBe(1)
    expect(store.distinctCidsOf(MetadataType.File)).toBe(1)
  })

  // The limit of that resume. Reusing the derived root is right only while the
  // upload still holds the bytes it was derived from, and `part A, failed
  // complete, part B, complete` is legal at every step: uploadChunk has no status
  // guard, the failed completion released the row to PENDING, and S3 permits
  // UploadPart after a failed CompleteMultipartUpload. Silently returning A's CID
  // would hand the client a truncated object to store and reference.
  it('refuses to reuse a root node once more parts have been stored', async () => {
    installFakeBlockstore()

    // Part A: one full chunk and a tail, i.e. the ordinary mid-upload state.
    const partA = Buffer.alloc(DEFAULT_MAX_CHUNK_SIZE + 1000, 1)
    let storedBytes = BigInt(partA.byteLength)
    let storedInfo: any = {
      upload_id: UPLOAD_ID,
      last_processed_part_index: null,
      pending_bytes: null,
      created_at: new Date(),
      updated_at: new Date(),
    }

    jest
      .spyOn(fileProcessingInfoRepository, 'getFileProcessingInfoByUploadId')
      .mockImplementation(async () => storedInfo)
    jest
      .spyOn(fileProcessingInfoRepository, 'updateFileProcessingInfo')
      .mockImplementation(async (info: any) => {
        storedInfo = { ...info }
        return storedInfo
      })
    jest
      .spyOn(filePartsRepository, 'getUploadFilePartsSize')
      .mockImplementation(async () => storedBytes)

    const upload = {
      id: UPLOAD_ID,
      root_upload_id: UPLOAD_ID,
      type: UploadType.FILE,
      name: 'grew.bin',
      upload_options: null,
    } as any
    jest.spyOn(uploadsRepository, 'getUploadEntryById').mockResolvedValue(upload)

    await UploadFileProcessingUseCase.processChunk(UPLOAD_ID, partA, 0)
    const firstCid =
      await UploadFileProcessingUseCase.completeUploadProcessing(upload)

    // Part B arrives while the upload is PENDING again after the failed
    // completion, then the client completes a second time.
    const partB = Buffer.alloc(DEFAULT_MAX_CHUNK_SIZE, 2)
    await UploadFileProcessingUseCase.processChunk(UPLOAD_ID, partB, 1)
    storedBytes += BigInt(partB.byteLength)

    await expect(
      UploadFileProcessingUseCase.completeUploadProcessing(upload),
    ).rejects.toThrow(UploadPartsChangedError)
    // Not a 500, and not retryable: the client has to abort and start again.
    await expect(
      UploadFileProcessingUseCase.completeUploadProcessing(upload),
    ).rejects.toMatchObject({ statusCode: 400 })

    // The truncated CID is never handed back.
    expect(cidToString(firstCid)).toBeDefined()
  })

  // The resume itself must keep working: same parts, same root, no error. This is
  // the advertised "top up your credits and retry" flow.
  it('still reuses the root node when the stored parts are unchanged', async () => {
    installFakeBlockstore()

    const part = Buffer.alloc(DEFAULT_MAX_CHUNK_SIZE + 500, 7)
    let storedInfo: any = {
      upload_id: UPLOAD_ID,
      last_processed_part_index: null,
      pending_bytes: null,
      created_at: new Date(),
      updated_at: new Date(),
    }
    jest
      .spyOn(fileProcessingInfoRepository, 'getFileProcessingInfoByUploadId')
      .mockImplementation(async () => storedInfo)
    jest
      .spyOn(fileProcessingInfoRepository, 'updateFileProcessingInfo')
      .mockImplementation(async (info: any) => {
        storedInfo = { ...info }
        return storedInfo
      })
    jest
      .spyOn(filePartsRepository, 'getUploadFilePartsSize')
      .mockResolvedValue(BigInt(part.byteLength))

    const upload = {
      id: UPLOAD_ID,
      root_upload_id: UPLOAD_ID,
      type: UploadType.FILE,
      name: 'unchanged.bin',
      upload_options: null,
    } as any
    jest.spyOn(uploadsRepository, 'getUploadEntryById').mockResolvedValue(upload)

    await UploadFileProcessingUseCase.processChunk(UPLOAD_ID, part, 0)
    const firstCid =
      await UploadFileProcessingUseCase.completeUploadProcessing(upload)
    const secondCid =
      await UploadFileProcessingUseCase.completeUploadProcessing(upload)

    expect(cidToString(secondCid)).toBe(cidToString(firstCid))
  })

  // Guards the other half: even if some future path does re-put the root node,
  // the ON CONFLICT DO NOTHING keeps it a single row rather than a duplicate.
  it('absorbs a repeated root node write instead of duplicating the row', async () => {
    const store = installFakeBlockstore()

    await blockstoreRepository.addBlockstoreEntry(
      UPLOAD_ID,
      'bafkr6icio4rqi75syx2xkxwmnnnwx3gzmnbjmtnqoydtfcxrjuqvvxxs4u',
      MetadataType.File,
      BigInt(10),
      Buffer.from('root'),
    )
    await blockstoreRepository.addBlockstoreEntry(
      UPLOAD_ID,
      'bafkr6icio4rqi75syx2xkxwmnnnwx3gzmnbjmtnqoydtfcxrjuqvvxxs4u',
      MetadataType.File,
      BigInt(10),
      Buffer.from('root'),
    )

    expect(store.countOf(MetadataType.File)).toBe(1)
  })

  // Chunks are deliberately NOT covered by the unique index: a file containing
  // two identical chunks legitimately stores two rows with the same CID, and the
  // DAG builder iterates every chunk row to build its links.
  it('still stores two identical chunk rows', async () => {
    const store = installFakeBlockstore()

    for (let i = 0; i < 2; i++) {
      await blockstoreRepository.addBlockstoreEntry(
        UPLOAD_ID,
        'bafkr6ie5s3iyyqjmnwqzuz5rzsnfhpvgvbrhfpwbcnbnqvbcqchbmqvxqm',
        MetadataType.FileChunk,
        BigInt(5),
        Buffer.from('chunk'),
      )
    }

    expect(store.countOf(MetadataType.FileChunk)).toBe(2)
  })
})

describe('createNodeDeduplicator', () => {
  const node = (cid: string) => ({ cid: cid as any })

  // The bug this replaces: uniqueNodes was built per batch, so a duplicate more
  // than BATCH_SIZE rows away from its original survived into nodes, where
  // nodes.cid has no unique constraint and getCidsByRootCid has no DISTINCT.
  it('drops a duplicate that arrives in a later batch', () => {
    const takeUnseen = createNodeDeduplicator(UPLOAD_ID)
    const firstBatch = Array.from({ length: 100 }, (_, i) => node(`cid-${i}`))

    expect(takeUnseen(firstBatch)).toHaveLength(100)
    // The duplicate of cid-0 lands 100 rows later, in the next batch.
    expect(takeUnseen([node('cid-0')])).toHaveLength(0)
    expect(takeUnseen([node('cid-100')])).toHaveLength(1)
  })

  it('still drops a duplicate within a single batch', () => {
    const takeUnseen = createNodeDeduplicator(UPLOAD_ID)

    expect(takeUnseen([node('a'), node('a'), node('b')])).toHaveLength(2)
  })

  it('keeps deduplication scoped to one upload', () => {
    const first = createNodeDeduplicator('upload-a')
    const second = createNodeDeduplicator('upload-b')

    expect(first([node('shared')])).toHaveLength(1)
    // A node shared between two objects must still be written for each.
    expect(second([node('shared')])).toHaveLength(1)
  })
})

// The deduplicator's unit tests above exercise the filter in isolation, where an
// empty result is harmless. It is not harmless at the call site: saveNodes([])
// renders `INSERT INTO nodes (...) VALUES ` and Postgres answers `syntax error at
// end of input`. So this drives the real migration over a real upload, which is
// also the only way to show the case is reachable without any broken rows.
describe('migrateFromBlockstoreToNodesTable over repeated content', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('writes one row per distinct node and never an empty insert', async () => {
    const store = installFakeBlockstore()

    let info: any = {
      upload_id: UPLOAD_ID,
      last_processed_part_index: null,
      pending_bytes: null,
      created_at: new Date(),
      updated_at: new Date(),
    }
    jest
      .spyOn(fileProcessingInfoRepository, 'getFileProcessingInfoByUploadId')
      .mockImplementation(async () => info)
    jest
      .spyOn(fileProcessingInfoRepository, 'updateFileProcessingInfo')
      .mockImplementation(async (next: any) => {
        info = { ...next }
        return info
      })

    let uploadedBytes = BigInt(0)
    jest
      .spyOn(filePartsRepository, 'getUploadFilePartsSize')
      .mockImplementation(async () => uploadedBytes)

    const uploadEntry = {
      id: UPLOAD_ID,
      root_upload_id: UPLOAD_ID,
      type: UploadType.FILE,
      name: 'zeros.bin',
      upload_options: null,
    } as any
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue(uploadEntry)
    jest
      .spyOn(uploadsRepository, 'getUploadsByRoot')
      .mockResolvedValue([uploadEntry])
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(ok({ type: 'file' } as any))
    jest
      .spyOn(nodesRepository, 'removeNodeByRootCid')
      .mockResolvedValue(undefined as any)

    // 14 MB of zeros, streamed part by part through the real chunker exactly as
    // uploadChunk's drain loop does. Every full chunk is byte-identical, so one
    // CID covers 225 of the 226 chunk rows — and getAllKeys yields one key per
    // ROW. The second batch of 100 is therefore entirely already-seen, which is
    // what the per-batch Map could never produce. Roughly 200 identical
    // consecutive chunks (about 13 MB at DEFAULT_MAX_CHUNK_SIZE=65066) is the
    // threshold; sparse files, zero-padded disk images and padded archives all
    // clear it.
    const PART_SIZE = 1024 * 1024
    const PARTS = 14
    expect(PARTS * PART_SIZE).toBeGreaterThan(200 * DEFAULT_MAX_CHUNK_SIZE)
    for (let i = 0; i < PARTS; i++) {
      await UploadFileProcessingUseCase.processChunk(
        UPLOAD_ID,
        Buffer.alloc(PART_SIZE, 0),
        i,
      )
      uploadedBytes += BigInt(PART_SIZE)
    }
    await UploadFileProcessingUseCase.completeUploadProcessing(uploadEntry)

    const distinctCids = new Set(store.rows.map((r) => r.cid))
    expect(store.rows.length).toBeGreaterThan(200)
    expect(distinctCids.size).toBeLessThan(store.rows.length)

    const insertedBatches: unknown[][] = []
    jest
      .spyOn(nodesRepository, 'saveNodes')
      .mockImplementation(async (nodes) => {
        insertedBatches.push(nodes)
        return undefined
      })

    await NodesUseCases.migrateFromBlockstoreToNodesTable(UPLOAD_ID)

    // The regression: one of these batches was empty, and the insert built from
    // it was not valid SQL.
    expect(insertedBatches.every((batch) => batch.length > 0)).toBe(true)
    // Each distinct node written exactly once, across every batch.
    expect(insertedBatches.flat()).toHaveLength(distinctCids.size)
  })

  // The guard on this used to be `if (!metadata) return` against a neverthrow
  // Result, which is always truthy — so it never fired and migration proceeded
  // without metadata, writing nodes that nothing would ever publish. Unrecoverable
  // is the honest verdict: the metadata is written before the upload reaches
  // MIGRATING, so a missing row cannot be fixed by retrying.
  it('parks an upload whose root has no metadata instead of migrating it', async () => {
    installFakeBlockstore()

    const uploadEntry = {
      id: UPLOAD_ID,
      root_upload_id: UPLOAD_ID,
      type: UploadType.FILE,
      name: 'orphan.bin',
      upload_options: null,
    } as any
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValue(uploadEntry)
    jest
      .spyOn(uploadsRepository, 'getUploadsByRoot')
      .mockResolvedValue([uploadEntry])
    jest
      .spyOn(BlockstoreUseCases, 'getFileUploadIdCID')
      .mockResolvedValue(stringToCid(ROOT_CID))
    jest
      .spyOn(ObjectUseCases, 'getMetadata')
      .mockResolvedValue(err(new ObjectNotFoundError('not found')))
    const removeNodes = jest
      .spyOn(nodesRepository, 'removeNodeByRootCid')
      .mockResolvedValue(undefined as any)
    const saveNodes = jest
      .spyOn(nodesRepository, 'saveNodes')
      .mockResolvedValue(undefined)

    await expect(
      NodesUseCases.migrateFromBlockstoreToNodesTable(UPLOAD_ID),
    ).rejects.toBeInstanceOf(UnrecoverableUploadError)
    // Nothing written, and nothing deleted either: the check happens before the
    // clear-and-reinsert.
    expect(removeNodes).not.toHaveBeenCalled()
    expect(saveNodes).not.toHaveBeenCalled()
  })
})
