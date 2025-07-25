import { User, AsyncDownloadStatus, AsyncDownload } from '@auto-drive/models'
import { asyncDownloadsRepository } from '../../repositories/asyncDownloads/index.js'
import { v4 } from 'uuid'
import { EventRouter } from '../../services/eventRouter/index.js'
import { downloadService } from '../../services/download/index.js'
import { ObjectUseCases } from '../objects/object.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('useCases:asyncDownloads')

const createDownload = async (
  user: User,
  cid: string,
): Promise<AsyncDownload> => {
  const metadata = await ObjectUseCases.getMetadata(cid)
  if (!metadata) {
    throw new Error('Object not found')
  }

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

  return download
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
): Promise<AsyncDownload | null> => {
  const download = await asyncDownloadsRepository.getDownloadById(downloadId)
  if (!download) {
    throw new Error('Download not found')
  }

  const metadata = await ObjectUseCases.getMetadata(download.cid)
  if (!metadata) {
    throw new Error('Object not found')
  }
  logger.trace(
    'Updating progress for download id=%s cid=%s, bytes downloaded: %s',
    downloadId,
    download.cid,
    downloadedBytes.toString(),
  )

  return asyncDownloadsRepository.updateDownloadProgress(
    downloadId,
    downloadedBytes,
    metadata.totalSize,
  )
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

const asyncDownload = async (downloadId: string): Promise<void> => {
  const download = await asyncDownloadsRepository.getDownloadById(downloadId)
  if (!download) {
    throw new Error('Download not found')
  }

  const metadata = await ObjectUseCases.getMetadata(download.cid)
  if (!metadata) {
    throw new Error('Object not found')
  }

  logger.info('Starting async download id=%s cid=%s', downloadId, download.cid)
  AsyncDownloadsUseCases.updateProgress(downloadId, BigInt(0))
  const file = await downloadService.download(download.cid)

  let downloadedBytes = 0n
  return new Promise((resolve, reject) => {
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
      resolve()
    })

    file.on('error', async (error) => {
      logger.error('Error downloading id=%s cid=%s', downloadId, download.cid)
      await AsyncDownloadsUseCases.setError(downloadId, JSON.stringify(error))
      reject(error)
    })
  })
}

const dismissDownload = async (
  user: User,
  downloadId: string,
): Promise<AsyncDownload | null> => {
  const download = await asyncDownloadsRepository.getDownloadById(downloadId)
  if (!download) {
    throw new Error('Download not found')
  }

  if (
    download.oauthProvider !== user.oauthProvider ||
    download.oauthUserId !== user.oauthUserId
  ) {
    throw new Error('User unauthorized')
  }

  return await AsyncDownloadsUseCases.updateStatus(
    downloadId,
    AsyncDownloadStatus.Dismissed,
  )
}

const getDownloadById = async (
  user: User,
  downloadId: string,
): Promise<AsyncDownload> => {
  const download = await asyncDownloadsRepository.getDownloadById(downloadId)
  if (!download) {
    throw new Error('Download not found')
  }

  if (
    download.oauthProvider !== user.oauthProvider ||
    download.oauthUserId !== user.oauthUserId
  ) {
    throw new Error('User unauthorized')
  }

  return download
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
