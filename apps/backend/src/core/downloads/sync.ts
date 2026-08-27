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
      // Charge AFTER the object is known to be servable, but refuse an
      // unaffordable download BEFORE building a stream for it.
      //
      // registerInteraction books the full object size and throws
      // PaymentRequiredError once the free tier is exhausted. Charging before
      // resolution meant a download that never delivered a byte was still paid
      // for — survivable while an unservable object failed slowly and
      // mid-stream, but not now that resolution failures surface in
      // milliseconds as an explicitly retryable 503: a client's retry budget
      // then buys many more attempts, each booking the full size, and a reader
      // could burn its way to a 402 lockout on an object it never received. On
      // /:id/public that charge lands on the PUBLISHER's account and any
      // anonymous visitor can drive it.
      //
      // Simply swapping the two is not enough. downloadService.download forks
      // the source stream for caching before it returns, so a throw after it
      // abandons a paused source, a paused fork and an open cache write, with
      // no handle left to close them — and the out-of-credits path is exactly
      // where a client retries hardest. Hence the read-only check first: the
      // ordinary insufficient-credits case never constructs a stream at all.
      const availableCredits =
        await AccountsUseCases.getPendingCreditsByUserAndType(
          reader,
          InteractionType.Download,
        )
      if (BigInt(availableCredits) < totalSize) {
        throw new PaymentRequiredError('Insufficient credits to process download')
      }

      const download = await downloadService.download(cid, options)

      // The check above is not a lock, so a concurrent download can still
      // consume the budget in between. That leaves the stream already built, so
      // tear it down rather than leaking it — this is the narrow race, not the
      // common path.
      try {
        await AccountsUseCases.registerInteraction(
          reader,
          InteractionType.Download,
          totalSize,
          cid,
        )
      } catch (error) {
        // Drain it, do not destroy it. stream-fork's Fork writes to every branch
        // on each chunk and does not check whether one has gone away, so
        // destroying this fork makes the next write throw `Cannot call write
        // after a stream was destroyed` from inside the Fork, where nothing is
        // listening. Draining lets the source and the cache branches run to
        // completion and end normally, which is what actually releases them.
        download.on('error', () => {})
        download.resume()
        throw error
      }

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
