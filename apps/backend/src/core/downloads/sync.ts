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
    ObjectNotFoundError | NotAcceptableError
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

  // NOTE: Download credit enforcement is intentionally disabled.
  // The infrastructure exists for future use, but download limits are not
  // enforced right now: purchased download bytes are not allocated on purchase,
  // so users have no way to replenish a depleted download quota — making the
  // block permanent. Re-enable once download credit purchasing is wired up.
  //
  // const pendingCredits = await AccountsUseCases.getPendingCreditsByUserAndType(
  //   reader,
  //   InteractionType.Download,
  // )
  // if (pendingCredits < metadata.totalSize) {
  //   return err(new PaymentRequiredError('Not enough download credits'))
  // }

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
      // Resolve the stream BEFORE charging. registerInteraction books the full
      // object size against the reader's quota and throws PaymentRequiredError
      // once the free tier is exhausted, so charging first means a download that
      // never delivers a byte is still paid for.
      //
      // That was survivable while an unservable object failed slowly, mid-stream,
      // seconds in. It is not now: resolution failures surface in milliseconds as
      // an explicitly retryable 503, so a client's retry budget buys many more
      // attempts in the same wall-clock, each one booking the full size. A reader
      // hitting an object during its migration window could burn its way to a
      // 402 lockout on an object it never received. On /:id/public the charge
      // lands on the PUBLISHER's account and any anonymous visitor can drive it.
      const download = await downloadService.download(cid, options)

      await AccountsUseCases.registerInteraction(
        reader,
        InteractionType.Download,
        totalSize,
        cid,
      )

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
