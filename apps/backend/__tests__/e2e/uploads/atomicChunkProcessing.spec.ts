import { jest } from '@jest/globals'
import { createHash, randomBytes } from 'crypto'
import { MemoryBlockstore } from 'blockstore-core'
import {
  cidOfNode,
  cidToString,
  createFileChunkIpldNode,
  decodeNode,
  DEFAULT_MAX_CHUNK_SIZE,
  encodeNode,
  IPLDNodeData,
  MetadataType,
  processFileToIPLDFormat,
} from '@autonomys/auto-dag-data'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { UploadFileProcessingUseCase } from '../../../src/core/uploads/uploadProcessing.js'
import { AccountsUseCases } from '../../../src/core/index.js'
import { UploadStatus } from '@auto-drive/models'
import { blockstoreRepository } from '../../../src/infrastructure/repositories/uploads/index.js'
import { CHUNK_ENTRIES_PER_INSERT } from '../../../src/infrastructure/repositories/uploads/blockstore.js'
import { filePartsRepository } from '../../../src/infrastructure/repositories/uploads/fileParts.js'
import { fileProcessingInfoRepository } from '../../../src/infrastructure/repositories/uploads/fileProcessingInfo.js'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { toBlockstoreRow } from '../../../src/infrastructure/services/upload/uploadProcessorCache/blockstore.js'
import { BadRequestError, ConflictError } from '../../../src/errors/index.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Parts of ~9 chunks each, so chunk boundaries cross parts and every part has
// both a carried-over tail and more than 8 nodes.
const PART_SIZE = 600_000

const sha256Of = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex')

// The CID a clean, single-pass chunking of the whole file produces.
const goldenCid = async (name: string, file: Buffer) =>
  cidToString(
    await processFileToIPLDFormat(
      new MemoryBlockstore(),
      [file],
      BigInt(file.length),
      name,
    ),
  )

const splitParts = (file: Buffer) => {
  const parts: Buffer[] = []
  for (let i = 0; i < file.length; i += PART_SIZE) {
    parts.push(file.subarray(i, i + PART_SIZE))
  }
  return parts
}

// Reads the file back out of the upload's blockstore by walking the DAG from
// its root, so missing, extra or reordered chunk rows all change the result.
const readBack = async (uploadId: string, rootCid: string) => {
  const chunks: Uint8Array[] = []
  const visit = async (cid: string): Promise<void> => {
    const entry = await blockstoreRepository.getByCid(uploadId, cid)
    expect(entry).not.toBeNull()
    const node = decodeNode(entry!.data)
    if (node.Links.length === 0) {
      chunks.push(IPLDNodeData.decode(node.Data!).data ?? new Uint8Array())
    }
    for (const link of node.Links) {
      await visit(cidToString(link.Hash))
    }
  }
  await visit(rootCid)
  return Buffer.concat(chunks)
}

const chunkRows = async (uploadId: string) =>
  (await blockstoreRepository.getByType(uploadId, MetadataType.FileChunk))
    .length

const cursor = async (uploadId: string) =>
  (await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(uploadId))
    ?.last_processed_part_index

describe('atomic per-part processing', () => {
  const user = createMockUser()
  // Captured before any spy replaces them, to call through from the spies.
  const realAddChunkEntries = blockstoreRepository.addChunkEntries
  const realAddBlockstoreEntry = blockstoreRepository.addBlockstoreEntry

  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  beforeEach(() => {
    mockRabbitPublish()
    // Credits are not what this is testing.
    jest
      .spyOn(AccountsUseCases, 'getPendingCreditsByUserAndType')
      .mockResolvedValue(Number.MAX_SAFE_INTEGER)
    jest
      .spyOn(AccountsUseCases, 'registerInteraction')
      .mockResolvedValue(undefined as any)
  })

  afterEach(() => {
    unmockMethods()
  })

  const createUpload = async (name: string) =>
    (
      await UploadsUseCases.createFileUpload(
        user,
        name,
        'application/octet-stream',
        null,
      )
    ).id

  // The completed upload must have the clean run's CID, read back as the source
  // bytes, and hold exactly one chunk row per chunk of the file.
  const expectCleanResult = async (
    uploadId: string,
    name: string,
    file: Buffer,
  ) => {
    const cid = await UploadsUseCases.completeUpload(user, uploadId)
    expect(cid).toBe(await goldenCid(name, file))
    expect(sha256Of(await readBack(uploadId, cid))).toBe(sha256Of(file))
    expect(await chunkRows(uploadId)).toBe(
      Math.ceil(file.length / DEFAULT_MAX_CHUNK_SIZE),
    )
  }

  it('rolls a part back when its chunk insert fails part-way, and the retry is clean', async () => {
    const name = 'insert-fails.bin'
    const file = randomBytes(3 * PART_SIZE)
    const parts = splitParts(file)
    const uploadId = await createUpload(name)

    await UploadsUseCases.uploadChunk(user, uploadId, 0, parts[0])
    const rowsAfterPart0 = await chunkRows(uploadId)

    // Writes the first 8 nodes of part 1, then fails.
    jest
      .spyOn(blockstoreRepository, 'addChunkEntries')
      .mockImplementationOnce(async (id, entries, executor) => {
        expect(entries.length).toBeGreaterThan(8)
        await realAddChunkEntries(id, entries.slice(0, 8), executor)
        throw new Error('injected failure after the 8th node')
      })
    await expect(
      UploadsUseCases.uploadChunk(user, uploadId, 1, parts[1]),
    ).rejects.toThrow('injected failure')

    expect(await chunkRows(uploadId)).toBe(rowsAfterPart0)
    expect(await cursor(uploadId)).toBe(0)

    await UploadsUseCases.uploadChunk(user, uploadId, 1, parts[1])
    await UploadsUseCases.uploadChunk(user, uploadId, 2, parts[2])
    await expectCleanResult(uploadId, name, file)
  })

  // A part of more nodes than one INSERT takes is written in batches as it is
  // chunked; a failure in a later batch must also undo the earlier ones.
  it('rolls back a part written across insert batches when a later batch fails', async () => {
    const name = 'batched-part.bin'
    const file = randomBytes(
      (CHUNK_ENTRIES_PER_INSERT + 10) * DEFAULT_MAX_CHUNK_SIZE + 1234,
    )
    const uploadId = await createUpload(name)

    jest
      .spyOn(blockstoreRepository, 'addChunkEntries')
      .mockImplementationOnce(realAddChunkEntries)
      .mockImplementationOnce(async () => {
        throw new Error('injected failure in the second batch')
      })
    await expect(
      UploadsUseCases.uploadChunk(user, uploadId, 0, file),
    ).rejects.toThrow('injected failure in the second batch')

    expect(await chunkRows(uploadId)).toBe(0)
    expect(await cursor(uploadId)).toBeNull()

    await UploadsUseCases.uploadChunk(user, uploadId, 0, file)
    await expectCleanResult(uploadId, name, file)
  }, 60_000)

  it('rolls a part back when the cursor update fails, and the retry is clean', async () => {
    const name = 'cursor-fails.bin'
    const file = randomBytes(3 * PART_SIZE)
    const parts = splitParts(file)
    const uploadId = await createUpload(name)

    await UploadsUseCases.uploadChunk(user, uploadId, 0, parts[0])
    const rowsAfterPart0 = await chunkRows(uploadId)

    jest
      .spyOn(fileProcessingInfoRepository, 'updateFileProcessingInfo')
      .mockRejectedValueOnce(new Error('injected cursor update failure'))
    await expect(
      UploadsUseCases.uploadChunk(user, uploadId, 1, parts[1]),
    ).rejects.toThrow('injected cursor update failure')

    expect(await chunkRows(uploadId)).toBe(rowsAfterPart0)
    expect(await cursor(uploadId)).toBe(0)

    await UploadsUseCases.uploadChunk(user, uploadId, 1, parts[1])
    await UploadsUseCases.uploadChunk(user, uploadId, 2, parts[2])
    await expectCleanResult(uploadId, name, file)
  })

  it('keeps one row per occurrence of a repeated chunk', async () => {
    const name = 'repeated.bin'
    const block = randomBytes(DEFAULT_MAX_CHUNK_SIZE)
    // 20 identical chunks, then distinct bytes and a short tail.
    const file = Buffer.concat([
      ...Array.from({ length: 20 }, () => block),
      randomBytes(3 * DEFAULT_MAX_CHUNK_SIZE + 1234),
    ])
    const uploadId = await createUpload(name)

    for (const [index, part] of splitParts(file).entries()) {
      await UploadsUseCases.uploadChunk(user, uploadId, index, part)
    }
    await expectCleanResult(uploadId, name, file)
  })

  it('processes parts that arrive out of order once the gap fills', async () => {
    const name = 'out-of-order.bin'
    const file = randomBytes(3 * PART_SIZE - 777)
    const parts = splitParts(file)
    const uploadId = await createUpload(name)

    await UploadsUseCases.uploadChunk(user, uploadId, 2, parts[2])
    expect(await cursor(uploadId)).toBeNull()
    expect(await chunkRows(uploadId)).toBe(0)

    await UploadsUseCases.uploadChunk(user, uploadId, 0, parts[0])
    expect(await cursor(uploadId)).toBe(0)

    await UploadsUseCases.uploadChunk(user, uploadId, 1, parts[1])
    expect(await cursor(uploadId)).toBe(2)
    await expectCleanResult(uploadId, name, file)
  })

  // Two drains on separate pool connections, which is what two backend
  // processes draining one upload look like to the database: the in-process
  // queue is bypassed, so only the row lock keeps them apart.
  it('processes each part once when two drains race on one upload', async () => {
    const name = 'concurrent.bin'
    const file = randomBytes(6 * PART_SIZE + 4321)
    const parts = splitParts(file)
    const uploadId = await createUpload(name)

    for (const [index, data] of parts.entries()) {
      await filePartsRepository.addChunk({
        upload_id: uploadId,
        part_index: index,
        data,
        created_at: new Date(),
        updated_at: new Date(),
      })
    }

    const processed: number[] = []
    const drain = async (drainer: number) => {
      while (await UploadFileProcessingUseCase.processNextPart(uploadId)) {
        processed.push(drainer)
      }
    }
    await Promise.all([drain(1), drain(2)])

    expect(processed).toHaveLength(parts.length)
    expect(await cursor(uploadId)).toBe(parts.length - 1)
    await expectCleanResult(uploadId, name, file)
  })

  // The response to a committed part is lost, so the client sends it again.
  it('treats a resent part that was already processed as a no-op', async () => {
    const name = 'resent.bin'
    const file = randomBytes(2 * PART_SIZE)
    const parts = splitParts(file)
    const uploadId = await createUpload(name)

    await UploadsUseCases.uploadChunk(user, uploadId, 0, parts[0])
    const rowsAfterPart0 = await chunkRows(uploadId)

    await UploadsUseCases.uploadChunk(user, uploadId, 0, parts[0])
    expect(await chunkRows(uploadId)).toBe(rowsAfterPart0)
    expect(await cursor(uploadId)).toBe(0)

    await UploadsUseCases.uploadChunk(user, uploadId, 1, parts[1])
    await expectCleanResult(uploadId, name, file)
  })

  // A single-chunk file is the chunker's destructive path: get, delete, then
  // put the root. Failing the root write must not leave the chunk deleted and
  // the tail consumed, or the retry derives a root over nothing.
  it('rolls back a completion whose derivation fails part-way', async () => {
    const name = 'single-chunk.bin'
    const file = randomBytes(1000)
    const uploadId = await createUpload(name)

    await UploadsUseCases.uploadChunk(user, uploadId, 0, file)

    const addEntry = jest
      .spyOn(blockstoreRepository, 'addBlockstoreEntry')
      .mockImplementation(async (...args) => {
        if (args[2] === MetadataType.File) {
          throw new Error('injected root write failure')
        }
        return realAddBlockstoreEntry(...args)
      })
    await expect(
      UploadsUseCases.completeUpload(user, uploadId),
    ).rejects.toThrow('injected root write failure')
    addEntry.mockRestore()

    const info =
      await fileProcessingInfoRepository.getFileProcessingInfoByUploadId(
        uploadId,
      )
    expect(info?.pending_bytes?.length).toBe(file.length)
    expect(await chunkRows(uploadId)).toBe(0)

    const cid = await UploadsUseCases.completeUpload(user, uploadId)
    expect(cid).toBe(await goldenCid(name, file))
    expect(sha256Of(await readBack(uploadId, cid))).toBe(sha256Of(file))
  })
  // Completion claims the upload before it takes the row lock, so a part that
  // reaches the lock afterwards must be refused, not stored into an upload whose
  // root does not cover it.
  it('refuses parts while completion holds the claim and after it finishes', async () => {
    const name = 'late-part.bin'
    const file = randomBytes(PART_SIZE)
    const late = randomBytes(1000)
    const uploadId = await createUpload(name)
    await UploadsUseCases.uploadChunk(user, uploadId, 0, file)

    expect(await uploadsRepository.claimUploadForCompletion(uploadId, 0)).toBe(
      true,
    )

    // Refused at once while the derivation holds the row lock, not after it.
    let lockTaken!: () => void
    const locked = new Promise<void>((resolve) => (lockTaken = resolve))
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const derivation = UploadFileProcessingUseCase.withFileProcessingLock(
      uploadId,
      async () => {
        lockTaken()
        await held
      },
    )
    await locked
    await expect(
      UploadsUseCases.uploadChunk(user, uploadId, 1, late),
    ).rejects.toBeInstanceOf(ConflictError)
    release()
    await derivation

    // A part that read the upload just before the claim is refused under the
    // lock.
    const claimed = await uploadsRepository.getUploadEntryById(uploadId)
    jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockResolvedValueOnce({ ...claimed!, status: UploadStatus.PENDING })
    await expect(
      UploadsUseCases.uploadChunk(user, uploadId, 1, late),
    ).rejects.toBeInstanceOf(ConflictError)
    await uploadsRepository.releaseUploadCompletionClaim(uploadId)

    await expectCleanResult(uploadId, name, file)
    const rows = await chunkRows(uploadId)
    await expect(
      UploadsUseCases.uploadChunk(user, uploadId, 1, late),
    ).rejects.toBeInstanceOf(BadRequestError)
    expect(await chunkRows(uploadId)).toBe(rows)
    expect(
      await filePartsRepository.getPartIndicesGreaterThan(uploadId, 0),
    ).toEqual([])
  })

  // A checked-out client has no pool 'error' listener, so without one of its own
  // a dropped connection's 'error' event would crash the process.
  it('survives the connection dropping mid-transaction and keeps the original error', async () => {
    const name = 'dropped-connection.bin'
    const file = randomBytes(PART_SIZE)
    const uploadId = await createUpload(name)

    await expect(
      UploadFileProcessingUseCase.withFileProcessingLock(
        uploadId,
        async (client) => {
          const ended = new Promise((resolve) => client.once('end', resolve))
          await client
            .query('SELECT pg_terminate_backend(pg_backend_pid())')
            .catch(() => undefined)
          await ended
          // ROLLBACK now fails too; this is the error the caller must see.
          throw new BadRequestError('original failure')
        },
      ),
    ).rejects.toThrow('original failure')

    await UploadsUseCases.uploadChunk(user, uploadId, 0, file)
    await expectCleanResult(uploadId, name, file)
  })

  // More nodes than one INSERT takes, so the rows span batches and must still
  // read back in the order given.
  it('keeps chunk rows in order across insert batches', async () => {
    const uploadId = await createUpload('batches.bin')
    const rows = Array.from({ length: 1001 }, (_, i) => {
      const node = createFileChunkIpldNode(Buffer.from(`chunk ${i}`))
      return toBlockstoreRow(cidOfNode(node), encodeNode(node))
    })

    await blockstoreRepository.addChunkEntries(uploadId, rows)

    const stored = await blockstoreRepository.getByType(
      uploadId,
      MetadataType.FileChunk,
    )
    expect(stored.map((e) => e.cid)).toEqual(rows.map((r) => r.cid))
  })
})
