import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { DownloadServiceOptions } from '@auto-drive/models'
import { ObjectUseCases } from '../object.js'
import { Readable } from 'stream'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import { ByteRange, readByteRange } from '@autonomys/file-server'
import { createEmptyReadable } from '../../../shared/utils/readable.js'
import { DBObjectFetcher, FileGatewayObjectFetcher } from './fetchers.js'
import { composeNodesDataAsFileReadable } from './nodeComposer.js'

const logger = createLogger('useCases:objects:files')

const selectObjectFetcher = async (metadata: OffchainMetadata) => {
  const isArchived = await ObjectUseCases.isArchived(metadata.dataCid)
  if (!isArchived) {
    return DBObjectFetcher
  }

  return (await ObjectUseCases.hasAllNodeData(metadata))
    ? DBObjectFetcher
    : FileGatewayObjectFetcher
}

const retrieveFileByteRange = async (
  metadata: OffchainMetadata,
  byteRange: ByteRange,
): Promise<Readable> => {
  if (metadata.type === 'folder') {
    throw new Error('Partial retrieval is not supported in folders')
  }

  logger.info(
    'retrieveFileByteRange called (cid=%s, byteRange=%s)',
    metadata.dataCid,
    byteRange,
  )
  return readByteRange(metadata.chunks, byteRange, async (chunks: string[]) => {
    const fetcher = await FilesUseCases.selectObjectFetcher(metadata)
    return composeNodesDataAsFileReadable({
      fetcher,
      chunks,
      concurrentChunks: 100,
    })
  })
}

const retrieveFullFile = async (metadata: OffchainMetadata) => {
  logger.debug(
    'retrieveObject called (cid=%s, type=%s)',
    metadata.dataCid,
    metadata.type,
  )
  const fetcher = await FilesUseCases.selectObjectFetcher(metadata)

  return fetcher.fetchFile(metadata.dataCid)
}

const retrieveObject = async (
  metadata: OffchainMetadata,
  options?: DownloadServiceOptions,
): Promise<Readable> => {
  if (BigInt(metadata.totalSize) === BigInt(0)) {
    return createEmptyReadable()
  }
  const byteRange = options?.byteRange

  const isFullRetrieval = !byteRange
  if (isFullRetrieval) {
    return FilesUseCases.retrieveFullFile(metadata)
  }

  return FilesUseCases.retrieveFileByteRange(metadata, byteRange)
}

export const FilesUseCases = {
  retrieveObject,
  retrieveFullFile,
  retrieveFileByteRange,
  selectObjectFetcher,
}
