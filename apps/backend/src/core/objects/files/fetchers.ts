import { Readable } from 'stream'
import {
  composeNodesDataAsFileReadable,
  retrieveAndReassembleFolderAsZip,
} from './nodeComposer.js'
import { NodesUseCases } from '../nodes.js'
import {
  FileGateway,
  fetchFileChunk,
  fetchGatewayFile,
  isFileCachedOnGateway,
} from '../../../infrastructure/services/dsn/fileGateway/index.js'
import { handleReadableError } from '../../../shared/utils/index.js'
import { ObjectUseCases } from '../object.js'
import { withTimeout } from '../../../shared/utils/timeout.js'
import { withBackingOffRetries } from '../../../shared/utils/retries.js'
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
const CHUNK_RETRIES = config.filesGateway.chunkRetries
const CHUNK_RETRY_DELAY_MS = config.filesGateway.chunkRetryDelayMs

/**
 * Streams a file out of the gateway with many chunk requests in flight.
 *
 * This is the cold path only — a file the gateway already holds is served by
 * fetchGatewayFile in a single streaming response, and composing it per chunk
 * instead would be ~19,650 requests to rebuild bytes the gateway has on disk.
 * Uncached, the SDK composes one chunk per read(), strictly in series: 19,649
 * round-trips for a 1.28 GB object, which is where most of the twenty-plus
 * minutes of a cold download goes. Chunk order is preserved and the end is
 * still decided by the gateway's 204, so the bytes are identical; only the
 * request pattern changes.
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
  let pumping = false
  const pending: Buffer[] = []

  // Held across pump turns rather than re-fetched: a consumer that fills up
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

  // One transient 5xx or timeout out of ~19,650 requests would otherwise fail
  // the whole retrieval. The SDK's own per-chunk fetch retries three times for
  // the same reason; this path has to do it itself.
  const fetchChunk = (index: number): Promise<Buffer | null> =>
    withBackingOffRetries(
      () =>
        withTimeout(
          fetchFileChunk(cid, index),
          GATEWAY_TIMEOUT_MS,
          `FileGateway.chunk(${cid},${index})`,
        ),
      { maxRetries: CHUNK_RETRIES, startingDelay: CHUNK_RETRY_DELAY_MS },
    )

  /**
   * Fetches until the consumer's buffer is full or the file ends.
   *
   * This is a loop rather than one batch per read() because read() MUST NOT be
   * async here. Node clears its own re-entrancy guard (`state.reading`) on the
   * first push(), so an async read() that pushes and then awaits is called
   * again while it is still suspended, and the second call reads the same
   * `nextChunk` and requests the same range. Both conditions that arm it hold
   * on this path: a chunk payload just under the 64 KiB high-water mark, so a
   * single push leaves room and returns true, and latency on the request, so
   * the second call lands inside the await.
   *
   * Measured against the async-read() version: 37 requests for a 21-request
   * file, over half the chunks fetched twice. Where the duplicate lands depends
   * on who wins the race — after end-of-stream it is dropped, before it the
   * chunk is emitted a second time as file content, which is a download longer
   * than the file it claims to be.
   *
   * So: `pumping` makes the pump single-flight, and the pump keeps going by
   * itself instead of relying on the read() it displaced. Claiming the range
   * before awaiting keeps `nextChunk` monotonic even if a future edit finds
   * another way in.
   */
  const pump = async (stream: Readable): Promise<void> => {
    if (pumping) return
    pumping = true
    try {
      for (;;) {
        // Buffer full: read() resumes us once the consumer has drained it.
        if (!drainPending(stream)) return

        if (exhausted) {
          stream.push(null)
          return
        }

        const remaining = expectedChunks - nextChunk
        const batchSize =
          remaining > 0 ? Math.min(CHUNK_CONCURRENCY, remaining) : 1
        const batchStart = nextChunk
        nextChunk += batchSize

        const batch = await Promise.all(
          Array.from({ length: batchSize }, (_, offset) =>
            fetchChunk(batchStart + offset),
          ),
        )

        // A 204 means we're past the last chunk, and so is everything after it
        // in this batch — rewind to what the file actually contains.
        const end = batch.indexOf(null)
        if (end !== -1) {
          exhausted = true
          nextChunk = batchStart + end
        }

        for (const data of end === -1 ? batch : batch.slice(0, end)) {
          pending.push(data!)
        }
      }
    } catch (error) {
      stream.destroy(error instanceof Error ? error : new Error(String(error)))
    } finally {
      pumping = false
    }
  }

  const readable = new Readable({
    read() {
      void pump(this)
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
      // A file the gateway has already reconstructed comes back in one
      // streaming response, which is what the SDK's getFile does on a cache hit
      // and what this used to get for free. Per-chunk composition is for the
      // cold path only: on a hit it would be ~19,650 requests, each one a fresh
      // DAG walk from the root gateway-side, for bytes already on its disk.
      if (await isFileCachedOnGateway(cid)) {
        logger.debug('Fetching cached file from gateway cid=%s', cid)
        return fetchGatewayFile(cid)
      }

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
