import { User } from '@auto-drive/models'
import {
  AsyncDownload,
  asyncDownloadsRepository,
} from '../../repositories/asyncDownloads/index.js'
import { v4 } from 'uuid'
import { TaskManager } from '../../services/taskManager/index.js'
import { downloadService } from '../../services/download/index.js'
import { ObjectUseCases } from '../objects/object.js'

enum AsyncDownloadStatus {
  Pending = 'pending',
  Downloading = 'downloading',
  Completed = 'completed',
  Failed = 'failed',
  Dismissed = 'dismissed',
}

const createDownload = async (
  user: User,
  cid: string,
): Promise<AsyncDownload> => {
  const download = await asyncDownloadsRepository.createDownload(
    v4(),
    user.oauthProvider,
    user.oauthUserId,
    cid,
    AsyncDownloadStatus.Pending,
  )

  TaskManager.publish({
    id: 'async-download-created',
    params: {
      downloadId: download.id,
    },
    retriesLeft: 3,
  })

  return download
}

const getDownloadsByUser = async (user: User): Promise<AsyncDownload[]> => {
  return asyncDownloadsRepository.getDownloadsByUser(
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

  const file = await downloadService.download(download.cid)

  let downloadedBytes = 0n
  file.on('data', (chunk) => {
    downloadedBytes += chunk.length
    updateProgress(downloadId, downloadedBytes)
  })

  file.on('end', () => {
    updateStatus(downloadId, AsyncDownloadStatus.Completed)
  })

  file.on('error', async (error) => {
    await setError(downloadId, JSON.stringify(error))
  })
}

const dismissDownload = async (
  downloadId: string,
): Promise<AsyncDownload | null> => {
  return await updateStatus(downloadId, AsyncDownloadStatus.Dismissed)
}

export const AsyncDownloadsUseCases = {
  createDownload,
  getDownloadsByUser,
  updateProgress,
  updateStatus,
  dismissDownload,
  asyncDownload,
}
