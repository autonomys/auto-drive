import { ByteRange } from '@autonomys/file-caching'
import { downloadService } from '../../services/download/index.js'
import {
  DownloadOptions,
  FileDownload,
  InteractionType,
  UserWithOrganization,
} from '@auto-drive/models'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { createLogger } from '../../drivers/logger.js'
import { ObjectUseCases } from './object.js'
import { SubscriptionsUseCases } from '../users/subscriptions.js'
import { config } from '../../config.js'

const logger = createLogger('useCases:objects:downloads')

const getCalculatedResultingByteRange = (
  metadata: OffchainMetadata,
  byteRange?: ByteRange,
): [number, number] => {
  return [
    byteRange?.[0] ?? 0,
    Math.min(
      byteRange?.[1] ?? Number(metadata.totalSize),
      Number(metadata.totalSize),
    ),
  ]
}

const downloadObjectByUser = async (
  reader: UserWithOrganization,
  cid: string,
  options: DownloadOptions = {},
): Promise<FileDownload> => {
  logger.debug(
    'downloadObjectByUser requested (cid=%s, userId=%s)',
    cid,
    reader.oauthUserId,
  )
  const information = await ObjectUseCases.getObjectInformation(cid)
  if (!information) {
    throw new Error(`Metadata with CID ${cid} not found`)
  }

  const pendingCredits =
    await SubscriptionsUseCases.getPendingCreditsByUserAndType(
      reader,
      InteractionType.Download,
    )
  const { metadata, tags } = information

  if (pendingCredits < metadata.totalSize) {
    throw new Error('Not enough download credits')
  }

  if (
    options.blockingTags &&
    tags.some(
      (tag) => options.blockingTags && options.blockingTags.includes(tag),
    )
  ) {
    throw new Error('File is blocked')
  }

  const resultingByteRange = getCalculatedResultingByteRange(
    metadata,
    options.byteRange,
  )
  logger.info(
    'downloadObjectByUser authorized (cid=%s, userId=%s)',
    cid,
    reader.oauthUserId,
  )

  const totalSize = BigInt(
    resultingByteRange[1] - resultingByteRange[0],
  ).valueOf()

  return {
    metadata,
    byteRange: options.byteRange ? resultingByteRange : undefined,
    startDownload: async () => {
      logger.trace(
        'downloadObjectByUser starting stream (cid=%s, userId=%s)',
        cid,
        reader.oauthUserId,
      )
      await SubscriptionsUseCases.registerInteraction(
        reader,
        InteractionType.Download,
        totalSize,
      )

      const download = await downloadService.download(cid, options)

      return download
    },
  }
}

const downloadObjectByAnonymous = async (
  cid: string,
  { blockingTags, byteRange }: DownloadOptions = {},
): Promise<FileDownload> => {
  logger.debug('downloadObjectByAnonymous requested (cid=%s)', cid)
  const information = await ObjectUseCases.getObjectInformation(cid)
  if (!information) {
    throw new Error(`Metadata with CID ${cid} not found`)
  }
  const { metadata, tags } = information
  if (metadata.totalSize > config.params.maxAnonymousDownloadSize) {
    throw new Error('File too large to be downloaded anonymously.')
  }
  if (blockingTags && tags.some((tag) => blockingTags.includes(tag))) {
    throw new Error('File is blocked')
  }

  const resultingByteRange = getCalculatedResultingByteRange(
    metadata,
    byteRange,
  )

  logger.info('downloadObjectByAnonymous authorized (cid=%s)', cid)
  return {
    metadata,
    byteRange: byteRange ? resultingByteRange : undefined,
    startDownload: async () => {
      logger.trace('downloadObjectByAnonymous starting stream (cid=%s)', cid)
      return downloadService.download(cid, { byteRange })
    },
  }
}

export const DownloadUseCase = {
  downloadObjectByUser,
  downloadObjectByAnonymous,
}
