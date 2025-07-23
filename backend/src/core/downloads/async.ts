import { User, AsyncDownloadStatus, AsyncDownload } from '@auto-drive/models'
import { asyncDownloadsRepository } from '../../infrastructure/repositories/asyncDownloads/index.js'
import { v4 } from 'uuid'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { downloadService } from '../../infrastructure/services/download/index.js'
import { ObjectUseCases } from '../objects/object.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
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
  AsyncDownloadsUseCases.updateProgress(downloadId, BigInt(0))

  const file = await downloadService.download(download.cid)

  let downloadedBytes = 0n
  return new Promise((resolve) => {
    file.on('data', (chunk) => {
      downloadedBytes += BigInt(chunk.length)
      logger.debug(
        'Async download id=%s cid=%s, bytes downloaded: %s',
        downloadId,
        download.cid,
        downloadedBytes.toString(),
      )
      AsyncDownloadsUseCases.updateProgress(downloadId, downloadedBytes)
    })

    file.on('end', () => {
      logger.info('Download completed id=%s cid=%s', downloadId, download.cid)
      AsyncDownloadsUseCases.updateStatus(
        downloadId,
        AsyncDownloadStatus.Completed,
      )
      resolve(ok(undefined))
    })

    file.on('error', async (error) => {
      logger.error('Error downloading id=%s cid=%s', downloadId, download.cid)
      await AsyncDownloadsUseCases.setError(downloadId, JSON.stringify(error))
      resolve(err(new InternalError('Failed to download object')))
    })
  })
}

const dismissDownload = async (
  user: User,
  downloadId: string,
): Promise<Result<AsyncDownload, ObjectNotFoundError>> => {
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
    throw new Error('User unauthorized')
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
