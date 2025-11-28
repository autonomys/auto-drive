import { ByteRange, DownloadMetadataFactory } from '@autonomys/file-server'
import { downloadService } from '../../infrastructure/services/download/index.js'
import {
  DownloadOptions,
  FileDownload,
  InteractionType,
  UserWithOrganization,
} from '@auto-drive/models'
import { CompressionAlgorithm, OffchainMetadata } from '@autonomys/auto-dag-data'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { ObjectUseCases } from '../objects/object.js'
import { AccountsUseCases } from '../users/accounts.js'
import { config } from '../../config.js'
import { err, ok, Result } from 'neverthrow'
import {
  NotAcceptableError,
  ObjectNotFoundError,
  PaymentRequiredError,
} from '../../errors/index.js'

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
): Promise<
  Result<
    FileDownload,
    ObjectNotFoundError | PaymentRequiredError | NotAcceptableError
  >
> => {
  logger.debug(
    'downloadObjectByUser requested (cid=%s, userId=%s)',
    cid,
    reader.oauthUserId,
  )
  const getResult = await ObjectUseCases.getMetadata(cid)
  if (getResult.isErr()) {
    return err(getResult.error)
  }
  const metadata = getResult.value
  const isCompressed =
    metadata.uploadOptions?.compression?.algorithm === CompressionAlgorithm.ZLIB
  const normalizedByteRange = isCompressed ? undefined : options.byteRange

  const pendingCredits = await AccountsUseCases.getPendingCreditsByUserAndType(
    reader,
    InteractionType.Download,
  )

  if (pendingCredits < metadata.totalSize) {
    return err(new PaymentRequiredError('Not enough download credits'))
  }

  const authResult = await ObjectUseCases.authorizeDownload(
    cid,
    options.blockingTags,
  )
  if (authResult.isErr()) {
    return err(authResult.error)
  }

  const resultingByteRange = normalizedByteRange
    ? getCalculatedResultingByteRange(metadata, normalizedByteRange)
    : undefined
  logger.info(
    'downloadObjectByUser authorized (cid=%s, userId=%s)',
    cid,
    reader.oauthUserId,
  )

  const totalSize = resultingByteRange
    ? BigInt(resultingByteRange[1] - resultingByteRange[0]).valueOf()
    : metadata.totalSize

  const downloadOptions = {
    ...options,
    byteRange: normalizedByteRange,
  }

  return ok({
    metadata: DownloadMetadataFactory.fromOffchainMetadata(metadata),
    byteRange: normalizedByteRange ? resultingByteRange : undefined,
    startDownload: async () => {
      logger.trace(
        'downloadObjectByUser starting stream (cid=%s, userId=%s)',
        cid,
        reader.oauthUserId,
      )
      await AccountsUseCases.registerInteraction(
        reader,
        InteractionType.Download,
        totalSize,
      )

      const download = await downloadService.download(cid, downloadOptions)

      return download
    },
  })
}

const downloadObjectByAnonymous = async (
  cid: string,
  options: DownloadOptions = {},
): Promise<
  Result<
    FileDownload,
    ObjectNotFoundError | PaymentRequiredError | NotAcceptableError
  >
> => {
  logger.debug('downloadObjectByAnonymous requested (cid=%s)', cid)
  const getResult = await ObjectUseCases.getMetadata(cid)
  if (getResult.isErr()) {
    return err(getResult.error)
  }
  const metadata = getResult.value
  const isCompressed =
    metadata.uploadOptions?.compression?.algorithm === CompressionAlgorithm.ZLIB
  const normalizedByteRange = isCompressed ? undefined : options.byteRange
  if (metadata.totalSize > config.params.maxAnonymousDownloadSize) {
    return err(
      new PaymentRequiredError('File too large to be downloaded anonymously.'),
    )
  }

  const authResult = await ObjectUseCases.authorizeDownload(
    cid,
    options.blockingTags,
  )
  if (authResult.isErr()) {
    return err(authResult.error)
  }

  const resultingByteRange = normalizedByteRange
    ? getCalculatedResultingByteRange(metadata, normalizedByteRange)
    : undefined

  logger.info('downloadObjectByAnonymous authorized (cid=%s)', cid)

  const downloadOptions = {
    ...options,
    byteRange: normalizedByteRange,
  }

  return ok({
    metadata: DownloadMetadataFactory.fromOffchainMetadata(metadata),
    byteRange: normalizedByteRange ? resultingByteRange : undefined,
    startDownload: async () => {
      logger.trace('downloadObjectByAnonymous starting stream (cid=%s)', cid)
      return downloadService.download(cid, downloadOptions)
    },
  })
}

export const DownloadUseCase = {
  downloadObjectByUser,
  downloadObjectByAnonymous,
}
