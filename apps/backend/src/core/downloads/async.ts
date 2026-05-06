import { User, AsyncDownloadStatus, AsyncDownload } from '@auto-drive/models'
import { asyncDownloadsRepository } from '../../infrastructure/repositories/asyncDownloads/index.js'
import { v4 } from 'uuid'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { downloadService } from '../../infrastructure/services/download/index.js'
import { ObjectUseCases } from '../objects/object.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { config } from '../../config.js'
import { err, ok, Result } from 'neverthrow'
import {
  ObjectNotFoundError,
  ForbiddenError,
  InternalError,
} from '../../errors/index.js'

const logger = createLogger('useCases:asyncDownloads')

const createDownload = async (
  user: User,
  cid: string,
): Promise<Result<AsyncDownload, ObjectNotFoundError>> => {
  const result = await ObjectUseCases.getMetadata(cid)
  if (result.isErr()) {
    return err(result.error)
  }
  const metadata = result.value

  const download = await asyncDownloadsRepository.createDownload(
    v4(),
    user.oauthProvider,
    user.oauthUserId,
    cid,
    AsyncDownloadStatus.Pending,
    metadata.totalSize,
  )
  logger.info('Creating async download id=%s cid=%s', download.id, cid)

  EventRouter.publish({
    id: 'async-download-created',
    params: {
      downloadId: download.id,
    },
    retriesLeft: 3,
  })

  return ok(download)
}

const getDownloadsByUser = async (user: User): Promise<AsyncDownload[]> => {
  return asyncDownloadsRepository.getUndismissedDownloadsByUser(
    user.oauthProvider,
    user.oauthUserId,
  )
}

const updateProgress = async (
  downloadId: string,
  downloadedBytes: bigint,
): Promise<Result<AsyncDownload, ObjectNotFoundError>> => {
  const download = await asyncDownloadsRepository.getDownloadById(downloadId)
  if (!download) {
    throw new Error('Download not found')
  }

  const result = await ObjectUseCases.getMetadata(download.cid)
  if (result.isErr()) {
    return err(result.error)
  }
  const metadata = result.value

  logger.trace(
    'Updating progress for download id=%s cid=%s, bytes downloaded: %s',
    downloadId,
    download.cid,
    downloadedBytes.toString(),
  )

  const updatedDownload = await asyncDownloadsRepository.updateDownloadProgress(
    downloadId,
    downloadedBytes,
    metadata.totalSize,
  )
  if (!updatedDownload) {
    return err(
      new ObjectNotFoundError(
        `Download with id=${downloadId} not found when updating progress`,
      ),
    )
  }

  return ok(updatedDownload)
}

const updateStatus = async (
  downloadId: string,
  status: AsyncDownloadStatus,
): Promise<AsyncDownload | null> => {
  return asyncDownloadsRepository.updateDownloadStatus(downloadId, status)
}

const setError = async (
  downloadId: string,
  error: string,
): Promise<AsyncDownload | null> => {
  const download = await asyncDownloadsRepository.getDownloadById(downloadId)
  if (!download) {
    throw new Error('Download not found')
  }

  logger.warn(
    'Setting error for download id=%s cid=%s, error: %s',
    downloadId,
    download.cid,
    error,
  )
  return asyncDownloadsRepository.updateDownloadStatus(
    downloadId,
    AsyncDownloadStatus.Failed,
    error,
  )
}

const asyncDownload = async (
  downloadId: string,
): Promise<Result<void, ObjectNotFoundError>> => {
  const download = await asyncDownloadsRepository.getDownloadById(downloadId)
  if (!download) {
    return err(
      new ObjectNotFoundError(`Download with id=${downloadId} not found`),
    )
  }

  const metadata = await ObjectUseCases.getMetadata(download.cid)
  if (metadata.isErr()) {
    return err(metadata.error)
  }

  logger.info('Starting async download id=%s cid=%s', downloadId, download.cid)
  const result = await AsyncDownloadsUseCases.updateProgress(
    downloadId,
    BigInt(0),
  )
  if (result.isErr()) {
    return err(result.error)
  }

  let file: Awaited<ReturnType<typeof downloadService.download>>
  try {
    file = await downloadService.download(download.cid)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : JSON.stringify(error)
    logger.error(
      'Failed to start download id=%s cid=%s: %s',
      downloadId,
      download.cid,
      message,
    )
    await AsyncDownloadsUseCases.setError(downloadId, message)
    return err(new InternalError('Failed to start download'))
  }

  let downloadedBytes = 0n
  const inactivityMs = config.params.downloadInactivityTimeoutMs

  return new Promise((resolve) => {
    let settled = false
    const settle = (value: Result<void, ObjectNotFoundError | InternalError>) => {
      if (settled) return
      settled = true
      clearTimeout(inactivityTimer)
      resolve(value)
    }

    // Inactivity timer — resets on every data chunk.  If no data arrives
    // within the window the stream is destroyed and the download marked
    // as failed.  This lets large files stream for hours while still
    // catching hung connections that stop producing data.
    //
    // The timer is NOT started at stream creation — the gateway may need
    // a long warm-up period (minutes) to begin fetching chunks from DSN
    // before any data flows.  The timer only activates after the first
    // data event, so the initial reconstruction delay is unbounded but
    // subsequent stalls are caught.
    let inactivityTimer: ReturnType<typeof setTimeout>
    const resetInactivityTimer = () => {
      clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(() => {
        logger.warn(
          'Async download id=%s cid=%s stalled — no data received for %dms (downloaded %s bytes so far)',
          downloadId,
          download.cid,
          inactivityMs,
          downloadedBytes.toString(),
        )
        file.destroy(
          new Error(
            `Download stalled: no data received for ${inactivityMs / 1000}s`,
          ),
        )
      }, inactivityMs)
    }

    file.on('data', async (chunk) => {
      resetInactivityTimer()
      downloadedBytes += BigInt(chunk.length)
      logger.debug(
        'Async download id=%s cid=%s, bytes downloaded: %s',
        downloadId,
        download.cid,
        downloadedBytes.toString(),
      )
      const result = await AsyncDownloadsUseCases.updateProgress(
        downloadId,
        downloadedBytes,
      )
      if (result.isErr()) {
        settle(err(result.error))
      }
    })

    file.on('end', async () => {
      logger.info('Download completed id=%s cid=%s', downloadId, download.cid)
      await AsyncDownloadsUseCases.updateStatus(
        downloadId,
        AsyncDownloadStatus.Completed,
      )
      settle(ok(undefined))
    })

    file.on('error', async (error) => {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error)
      logger.error(
        'Error downloading id=%s cid=%s: %s',
        downloadId,
        download.cid,
        message,
      )
      await AsyncDownloadsUseCases.setError(downloadId, message)
      settle(err(new InternalError('Failed to download object')))
    })
  })
}

const dismissDownload = async (
  user: User,
  downloadId: string,
): Promise<Result<AsyncDownload, ObjectNotFoundError | ForbiddenError>> => {
  const download = await asyncDownloadsRepository.getDownloadById(downloadId)
  if (!download) {
    return err(
      new ObjectNotFoundError(`Download with id=${downloadId} not found`),
    )
  }

  if (
    download.oauthProvider !== user.oauthProvider ||
    download.oauthUserId !== user.oauthUserId
  ) {
    return err(
      new ForbiddenError(
        `User ${user.oauthProvider}:${user.oauthUserId} is not the owner of download ${downloadId}`,
      ),
    )
  }

  const updatedDownload = await AsyncDownloadsUseCases.updateStatus(
    downloadId,
    AsyncDownloadStatus.Dismissed,
  )
  if (!updatedDownload) {
    return err(
      new ObjectNotFoundError(
        `Download with id=${downloadId} not found when updating status`,
      ),
    )
  }

  return ok(updatedDownload)
}

const getDownloadById = async (
  user: User,
  downloadId: string,
): Promise<Result<AsyncDownload, ObjectNotFoundError | ForbiddenError>> => {
  const download = await asyncDownloadsRepository.getDownloadById(downloadId)
  if (!download) {
    return err(
      new ObjectNotFoundError(`Download with id=${downloadId} not found`),
    )
  }

  if (
    download.oauthProvider !== user.oauthProvider ||
    download.oauthUserId !== user.oauthUserId
  ) {
    return err(
      new ForbiddenError(
        `User ${user.oauthProvider}:${user.oauthUserId} is not the owner of download ${downloadId}`,
      ),
    )
  }

  return ok(download)
}

export const AsyncDownloadsUseCases = {
  createDownload,
  getDownloadsByUser,
  updateProgress,
  updateStatus,
  dismissDownload,
  asyncDownload,
  setError,
  getDownloadById,
}
