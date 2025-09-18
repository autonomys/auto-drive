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
  logger.debug('retrieveAndReassembleFile called (cid=%s)', chunks[0])
  if (chunks.length === 1) {
    const chunkData = await fetcher.fetchNode(chunks[0])
    if (!chunkData) {
      throw new Error(`Chunk not found: cid=${chunks[0]}`)
    }

    return Readable.from(chunkData)
  }

  let currentIndex = 0
  const readable = new Readable({
    async read() {
      if (currentIndex >= chunks.length) {
        this.push(null)
        return
      }

      const endIndex = currentIndex + concurrentChunks
      const chunksToDownload = chunks.slice(currentIndex, endIndex)

      try {
        const chunkedData = await Promise.all(
          chunksToDownload.map((chunk) => fetcher.fetchNode(chunk)),
        )

        if (chunkedData.some((e) => e === undefined)) {
          const notFoundChunkIndex = chunkedData.findIndex(
            (e) => e === undefined,
          )
          this.destroy(
            new Error(
              `Chunk not found: cid=${chunksToDownload[notFoundChunkIndex]}`,
            ),
          )
          return
        }

        for (const data of chunkedData) {
          currentIndex++
          if (!this.push(data)) {
            return
          }
        }
      } catch (err) {
        console.log('Error', err)
        this.destroy(err instanceof Error ? err : new Error(String(err)))
      }
    },
  })

  // Ensure any emitted errors are observed by a listener to avoid unhandled error
  handleReadableError(
    readable,
    'composeNodesDataAsFileReadable error cid=%s',
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
