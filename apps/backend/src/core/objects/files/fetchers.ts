import { Readable } from 'stream'
import {
  composeNodesDataAsFileReadable,
  retrieveAndReassembleFolderAsZip,
} from './nodeComposer.js'
import { NodesUseCases } from '../nodes.js'
import {
  FileGateway,
  fetchFileChunk,
} from '../../../infrastructure/services/dsn/fileGateway/index.js'
import { handleReadableError } from '../../../shared/utils/index.js'
import { ObjectUseCases } from '../object.js'
import { withTimeout } from '../../../shared/utils/timeout.js'
import { config } from '../../../config.js'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import PizZip from 'pizzip'

const logger = createLogger('useCases:objects:files:fetchers')

const GATEWAY_TIMEOUT_MS = config.filesGateway.fetchTimeoutMs

export interface ObjectFetcher {
  fetchFile(cid: string): Promise<Readable>
  fetchNode(cid: string): Promise<Buffer>
}

export const DBObjectFetcher: ObjectFetcher = {
  async fetchFile(cid: string): Promise<Readable> {
    const getMetadataResult = await ObjectUseCases.getMetadata(cid)
    if (getMetadataResult.isErr()) {
      throw new Error(`Object not found: cid=${cid}`)
    }
    const metadata = getMetadataResult.value

    if (metadata.type === 'file') {
      return composeNodesDataAsFileReadable({
        fetcher: DBObjectFetcher,
        chunks: metadata.chunks.map((chunk) => chunk.cid),
        concurrentChunks: 100,
      })
    }

    return retrieveAndReassembleFolderAsZip(new PizZip(), cid)
  },
  async fetchNode(cid: string): Promise<Buffer> {
    const chunkData = await NodesUseCases.getChunkData(cid)
    if (!chunkData) {
      throw new Error(`Chunk not found: cid=${cid}`)
    }
    return chunkData
  },
}

const CHUNK_CONCURRENCY = config.filesGateway.chunkConcurrency

/**
 * Streams a file out of the gateway with many chunk requests in flight.
 *
 * FileGateway.getFile does the same job one chunk per read(), strictly in
 * series — 19,649 round-trips for a 1.28 GB object, which is where most of the
 * twenty-plus minutes of a cold download goes. Chunk order is preserved and the
 * end is detected the same way the SDK detects it (a 204 past the last chunk),
 * so the bytes are identical; only the request pattern changes.
 *
 * `expectedChunks` comes from our own metadata and is a sizing hint, not a
 * bound: batches are capped to it so the tail doesn't fan out into requests
 * that can only 204, but the 204 still decides where the file ends. If the
 * gateway ever disagreed with our chunk count, this would keep reading rather
 * than truncate the file.
 */
const composeGatewayFileReadable = (
  cid: string,
  expectedChunks: number,
): Readable => {
  let nextChunk = 0
  let exhausted = false
  const pending: Buffer[] = []

  // Held across read() calls rather than re-fetched: a consumer that fills up
  // mid-batch would otherwise throw away up to CHUNK_CONCURRENCY chunks that
  // were already paid for, and pull them again on the next read.
  const drainPending = (stream: Readable): boolean => {
    while (pending.length > 0) {
      if (!stream.push(pending.shift()!)) {
        return false
      }
    }
    return true
  }

  const readable = new Readable({
    async read() {
      try {
        if (!drainPending(this)) return

        if (exhausted) {
          this.push(null)
          return
        }

        const remaining = expectedChunks - nextChunk
        const batchSize =
          remaining > 0 ? Math.min(CHUNK_CONCURRENCY, remaining) : 1

        const batch = await Promise.all(
          Array.from({ length: batchSize }, (_, offset) => {
            const index = nextChunk + offset
            return withTimeout(
              fetchFileChunk(cid, index),
              GATEWAY_TIMEOUT_MS,
              `FileGateway.chunk(${cid},${index})`,
            )
          }),
        )

        for (const data of batch) {
          // A 204 means we're past the last chunk, and so is everything after
          // it in this batch.
          if (data === null) {
            exhausted = true
            break
          }
          nextChunk++
          pending.push(data)
        }

        if (!drainPending(this)) return
        if (exhausted) this.push(null)
      } catch (error) {
        this.destroy(error instanceof Error ? error : new Error(String(error)))
      }
    },
  })

  handleReadableError(readable, 'Gateway file stream error cid=%s', cid)

  return readable
}

export const FileGatewayObjectFetcher: ObjectFetcher = {
  async fetchFile(cid: string): Promise<Readable> {
    const getMetadataResult = await ObjectUseCases.getMetadata(cid)
    if (getMetadataResult.isErr()) {
      throw new Error(`Object not found: cid=${cid}`)
    }
    const metadata = getMetadataResult.value

    if (metadata.type === 'file') {
      logger.debug(
        'Fetching file from gateway cid=%s (chunks=%d, concurrency=%d)',
        cid,
        metadata.chunks.length,
        CHUNK_CONCURRENCY,
      )
      return composeGatewayFileReadable(cid, metadata.chunks.length)
    }

    return retrieveAndReassembleFolderAsZip(new PizZip(), cid)
  },
  async fetchNode(cid: string): Promise<Buffer> {
    const node = await withTimeout(
      FileGateway.getNode(cid),
      GATEWAY_TIMEOUT_MS,
      `FileGateway.getNode(${cid})`,
    )
    return Buffer.from(node)
  },
}
