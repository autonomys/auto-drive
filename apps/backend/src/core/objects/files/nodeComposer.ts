import { Readable } from 'stream'
import { handleReadableError } from '../../../shared/utils/index.js'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import { ObjectFetcher } from './fetchers.js'
import { ObjectUseCases } from '../object.js'
import { downloadService } from '../../../infrastructure/services/download/index.js'
import { asyncIterableToPromiseOfArray } from '@autonomys/asynchronous'
import PizZip from 'pizzip'

const logger = createLogger('useCases:objects:files:nodeComposer')

export const composeNodesDataAsFileReadable = async ({
  fetcher,
  chunks,
  concurrentChunks = 100,
}: {
  fetcher: ObjectFetcher
  chunks: string[]
  concurrentChunks: number
}): Promise<Readable> => {
  logger.debug('retrieveAndReassembleFile called (firstChunkCid=%s)', chunks[0])
  if (chunks.length === 1) {
    return Readable.from(await fetcher.fetchNode(chunks[0]))
  }

  // Resolve the first batch eagerly, BEFORE the Readable is handed back.
  //
  // Callers pipe this straight into the response, which commits 200 + headers on
  // the first write; from that point a failure can only be signalled by
  // resetting the stream, and the client sees `INTERNAL_ERROR; received from
  // peer` with no status, no S3 error body, and no way to tell "retry me" from
  // "permanently broken" (issue #815). Resolving the first batch here means an
  // object that cannot be served at all fails while the caller can still turn it
  // into a real HTTP status.
  //
  // It bounds the exposure rather than removing it: chunks beyond the first
  // batch are still fetched mid-stream. What made those fail was the read/commit
  // straddle in the chunk lookup, and that is closed at the source in
  // nodesRepository.resolveEncodedNodes; what remains is a node genuinely absent
  // from both tables, which no amount of pre-checking can serve. Validating every
  // CID up front was the alternative — rejected because a 1 GiB object carries
  // ~16k chunk CIDs and would pay that on every uncached download to narrow an
  // already-closed window.
  const firstBatch = await fetcher.fetchNodes(
    chunks.slice(0, concurrentChunks),
  )

  let currentIndex = 0
  let pending: Buffer[] = firstBatch
  const readable = new Readable({
    async read() {
      if (currentIndex >= chunks.length) {
        this.push(null)
        return
      }

      try {
        if (pending.length === 0) {
          pending = await fetcher.fetchNodes(
            chunks.slice(currentIndex, currentIndex + concurrentChunks),
          )
        }

        while (pending.length > 0) {
          const data = pending.shift()!
          currentIndex++
          if (!this.push(data)) {
            return
          }
        }
      } catch (err) {
        this.destroy(err instanceof Error ? err : new Error(String(err)))
      }
    },
  })

  // Ensure any emitted errors are observed by a listener to avoid unhandled error
  handleReadableError(
    readable,
    'composeNodesDataAsFileReadable error (firstChunkCid=%s)',
    chunks[0],
  )

  return readable
}

export const retrieveAndReassembleFolderAsZip = async (
  parent: PizZip,
  cid: string,
): Promise<Readable> => {
  logger.debug('retrieveAndReassembleFolderAsZip called (cid=%s)', cid)
  const getMetadataResult = await ObjectUseCases.getMetadata(cid)
  if (getMetadataResult.isErr()) {
    throw new Error(`Metadata with CID ${cid} not found`)
  }
  const metadata = getMetadataResult.value

  if (!metadata.name) {
    throw new Error(`Metadata with CID ${cid} has no name`)
  }

  if (metadata.type !== 'folder') {
    throw new Error(`Metadata with CID ${cid} is not a folder`)
  }

  const folder = parent.folder(metadata.name)

  await Promise.all([
    ...metadata.children
      .filter((e) => e.type === 'file')
      .map(async (e) => {
        const data = Buffer.concat(
          await asyncIterableToPromiseOfArray(
            await downloadService.download(e.cid),
          ),
        )

        if (!data) {
          throw new Error(`Data with CID ${e.cid} not found`)
        }

        return folder.file(e.name!, data)
      }),
    ...metadata.children
      .filter((e) => e.type === 'folder')
      .map(async (e) => {
        return retrieveAndReassembleFolderAsZip(folder, e.cid)
      }),
  ])

  return Readable.from(folder.generate({ type: 'nodebuffer' }))
}
