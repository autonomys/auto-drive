import { OffchainMetadata, ChunkInfo } from '@autonomys/auto-dag-data'
import { DownloadServiceOptions } from '@auto-drive/models'
import { ObjectUseCases } from '../object.js'
import { Readable } from 'stream'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import { ByteRange } from '@autonomys/file-server'
import { sliceReadable } from '../../../shared/utils/readable.js'
import { DBObjectFetcher, FileGatewayObjectFetcher } from './fetchers.js'
import { composeNodesDataAsFileReadable } from './nodeComposer.js'

const logger = createLogger('useCases:objects:files')

const getNodesForPartialRetrieval = async (
  chunks: ChunkInfo[],
  byteRange: ByteRange,
): Promise<{
  nodes: string[]
  firstNodeFileOffset: number
}> => {
  let accumulatedLength = 0
  const nodeRange: [number | null, number | null] = [null, null]
  let firstNodeFileOffset: number | undefined
  let i = 0

  logger.info('getNodesForPartialRetrieval called (byteRange=%s)', byteRange)

  // Searchs for the first node that contains the byte range
  while (nodeRange[0] === null && i < chunks.length) {
    const chunk = chunks[i]
    const chunkSize = Number(chunk.size.valueOf())
    // [accumulatedLength, accumulatedLength + chunkSize) // is the range of the chunk
    if (
      byteRange[0] >= accumulatedLength &&
      byteRange[0] < accumulatedLength + chunkSize
    ) {
      nodeRange[0] = i
      firstNodeFileOffset = accumulatedLength
    } else {
      accumulatedLength += chunkSize
      i++
    }
  }

  // Searchs for the last node that contains the byte range
  // unless the byte range is the last byte of the file
  if (byteRange[1]) {
    while (nodeRange[1] === null && i < chunks.length) {
      const chunk = chunks[i]
      const chunkSize = Number(chunk.size.valueOf())
      if (
        byteRange[1] >= accumulatedLength &&
        byteRange[1] < accumulatedLength + chunkSize
      ) {
        nodeRange[1] = i
      }
      accumulatedLength += chunkSize
      i++
    }
  }

  if (nodeRange[0] == null) {
    throw new Error('Byte range not found')
  }

  const nodes = chunks
    .slice(nodeRange[0], nodeRange[1] === null ? undefined : nodeRange[1] + 1)
    .map((e) => e.cid)

  return {
    nodes,
    firstNodeFileOffset: firstNodeFileOffset ?? 0,
  }
}

const retrieveFileByteRange = async (
  metadata: OffchainMetadata,
  byteRange: ByteRange,
): Promise<Readable> => {
  if (metadata.type === 'folder') {
    throw new Error('Partial retrieval is not supported in folders')
  }

  const { nodes, firstNodeFileOffset } = await getNodesForPartialRetrieval(
    metadata.chunks,
    byteRange,
  )

  const isArchived = await ObjectUseCases.isArchived(metadata.dataCid)
  const fetcher = isArchived ? FileGatewayObjectFetcher : DBObjectFetcher

  const reader = await composeNodesDataAsFileReadable({
    fetcher,
    chunks: nodes,
    concurrentChunks: 100,
  })

  const offsetWithinFirstNode = byteRange[0] - firstNodeFileOffset
  const upperBound = byteRange[1] ?? Number(metadata.totalSize)
  const length = upperBound - byteRange[0] + 1

  logger.info(
    'retrieveFileByteRange called (cid=%s, byteRange=%s, offsetWithinFirstNode=%s, length=%s)',
    metadata.dataCid,
    byteRange,
    offsetWithinFirstNode,
    length,
  )
  return sliceReadable(reader, offsetWithinFirstNode, length)
}

const retrieveFullFile = async (metadata: OffchainMetadata) => {
  logger.debug(
    'retrieveObject called (cid=%s, type=%s)',
    metadata.dataCid,
    metadata.type,
  )
  const isArchived = await ObjectUseCases.isArchived(metadata.dataCid)

  const fetcher = isArchived ? FileGatewayObjectFetcher : DBObjectFetcher

  return fetcher.fetchFile(metadata.dataCid)
}

const retrieveObject = async (
  metadata: OffchainMetadata,
  options?: DownloadServiceOptions,
): Promise<Readable> => {
  const byteRange = options?.byteRange

  const isFullRetrieval = !byteRange
  if (isFullRetrieval) {
    return retrieveFullFile(metadata)
  }

  return retrieveFileByteRange(metadata, byteRange)
}

export const FilesUseCases = {
  getNodesForPartialRetrieval,
  retrieveObject,
}
