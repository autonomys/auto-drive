import { ByteRange, DownloadMetadataFactory } from '@autonomys/file-server'
import { downloadService } from '../../infrastructure/services/download/index.js'
import {
  DownloadOptions,
  FileDownload,
  InteractionType,
  UserWithOrganization,
} from '@auto-drive/models'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
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
  // Byte ranges are 0-indexed and inclusive, so max valid index is totalSize - 1
  const maxEndByte = Number(metadata.totalSize) - 1
  return [
    byteRange?.[0] ?? 0,
    Math.min(byteRange?.[1] ?? maxEndByte, maxEndByte),
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

  const resultingByteRange = getCalculatedResultingByteRange(
    metadata,
    options.byteRange,
  )
  logger.info(
    'downloadObjectByUser authorized (cid=%s, userId=%s)',
    cid,
    reader.oauthUserId,
  )

  // Byte ranges are inclusive, so length = end - start + 1
  const totalSize = BigInt(
    resultingByteRange[1] - resultingByteRange[0] + 1,
  ).valueOf()

  return ok({
    metadata: DownloadMetadataFactory.fromOffchainMetadata(metadata),
    byteRange: options.byteRange ? resultingByteRange : undefined,
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

      const download = await downloadService.download(cid, options)

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

  const resultingByteRange = getCalculatedResultingByteRange(
    metadata,
    options.byteRange,
  )

  logger.info('downloadObjectByAnonymous authorized (cid=%s)', cid)

  return ok({
    metadata: DownloadMetadataFactory.fromOffchainMetadata(metadata),
    byteRange: options.byteRange ? resultingByteRange : undefined,
    startDownload: async () => {
      logger.trace('downloadObjectByAnonymous starting stream (cid=%s)', cid)
      return downloadService.download(cid, options)
    },
  })
}

export const DownloadUseCase = {
  downloadObjectByUser,
  downloadObjectByAnonymous,
}
