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

  // Don't let anyone queue a download for an object removed by its owner.
  if (await ObjectUseCases.isObjectDeleted(cid)) {
    return err(new ObjectNotFoundError(`Object with cid=${cid} not found`))
  }

  // Repeat requests join the run already in flight instead of starting another.
  // The UI calls this from both the download modal and "Bring to Cache", and a
  // reconstruction takes long enough that a user will click again — which used
  // to mean a second row, a second task, and a second full pull of the same
  // object competing with the first for the same gateway.
  const existing = await asyncDownloadsRepository.getActiveDownloadByCidAndUser(
    cid,
    user.oauthProvider,
    user.oauthUserId,
    config.params.asyncDownloadStaleAfterMs,
  )
  if (existing) {
    logger.info(
      'Reusing in-flight async download id=%s cid=%s',
      existing.id,
      cid,
    )
    return ok(existing)
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
  signal?: AbortSignal,
): Promise<Result<void, ObjectNotFoundError>> => {
  if (signal?.aborted) {
    return err(new ObjectNotFoundError('Task aborted before start'))
  }

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

  // The object may have been removed by its owner after the download was
  // queued — stop here so removed objects are never served.
  if (await ObjectUseCases.isObjectDeleted(download.cid)) {
    return err(
      new ObjectNotFoundError(`Object with cid=${download.cid} not found`),
    )
  }

  logger.info('Starting async download id=%s cid=%s', downloadId, download.cid)
  const result = await AsyncDownloadsUseCases.updateProgress(
    downloadId,
    BigInt(0),
  )
  if (result.isErr()) {
    return err(result.error)
  }

  // Nothing ever wrote this status before, so a reconstruction sat on "Pending"
  // for its entire run — the badge renders a percentage only for Downloading,
  // which meant the one screen the user watches showed no sign of progress for
  // twenty minutes and read as a stuck job. Setting it here also un-sticks a
  // row a previous attempt left as Failed: a retry of this task now visibly
  // takes over instead of leaving the earlier failure on screen.
  await AsyncDownloadsUseCases.updateStatus(
    downloadId,
    AsyncDownloadStatus.Downloading,
  ).catch((e) =>
    logger.warn(
      e as Error,
      'Failed to mark download as downloading id=%s',
      downloadId,
    ),
  )

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

    // Keeps the row readable as alive while nothing else is writing to it. The
    // status endpoint reports any recently-stamped Pending/Downloading row for
    // a cid to every user, and the client disables its own request while one is
    // running — so without a heartbeat the only way to tell a worker that died
    // from one still waiting on the gateway's first byte would be to wait long
    // enough that a dead row blocks the cid for everyone in the meantime.
    const heartbeat = setInterval(() => {
      asyncDownloadsRepository
        .touchDownload(downloadId)
        .catch((e) =>
          logger.warn(
            e as Error,
            'Failed to stamp heartbeat for download id=%s',
            downloadId,
          ),
        )
    }, config.params.asyncDownloadHeartbeatMs)
    heartbeat.unref()

    const settle = (value: Result<void, ObjectNotFoundError | InternalError>) => {
      if (settled) return
      settled = true
      clearTimeout(inactivityTimer)
      clearInterval(heartbeat)
      resolve(value)
    }

    const onAbort = () => {
      if (settled) return
      logger.warn(
        'Async download id=%s cid=%s aborted by signal (downloaded %s bytes so far)',
        downloadId,
        download.cid,
        downloadedBytes.toString(),
      )
      file.destroy(new Error('Download aborted by task timeout'))
    }

    if (signal) {
      if (signal.aborted) {
        file.destroy(new Error('Download aborted by task timeout'))
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
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
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined
    const resetInactivityTimer = () => {
      clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(() => {
        if (settled) return
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

    file.on('data', (chunk) => {
      resetInactivityTimer()
      downloadedBytes += BigInt(chunk.length)
      logger.debug(
        'Async download id=%s cid=%s, bytes downloaded: %s',
        downloadId,
        download.cid,
        downloadedBytes.toString(),
      )
      AsyncDownloadsUseCases.updateProgress(
        downloadId,
        downloadedBytes,
      ).catch((e) => {
        logger.error(
          e as Error,
          'Failed to update progress for download id=%s',
          downloadId,
        )
      })
    })

    file.on('end', () => {
      signal?.removeEventListener('abort', onAbort)
      logger.info('Download completed id=%s cid=%s', downloadId, download.cid)
      AsyncDownloadsUseCases.updateStatus(
        downloadId,
        AsyncDownloadStatus.Completed,
      )
        .catch((e) => {
          logger.error(
            e as Error,
            'Failed to mark download as completed id=%s',
            downloadId,
          )
        })
        .finally(() => settle(ok(undefined)))
    })

    file.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      const message =
        error instanceof Error ? error.message : JSON.stringify(error)
      logger.error(
        'Error downloading id=%s cid=%s: %s',
        downloadId,
        download.cid,
        message,
      )
      AsyncDownloadsUseCases.setError(downloadId, message)
        .catch((e) => {
          logger.error(
            e as Error,
            'Failed to set error for download id=%s',
            downloadId,
          )
        })
        .finally(() => settle(err(new InternalError('Failed to download object'))))
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

/**
 * Whatever the server can currently say about an uncached object being pulled
 * back from the DSN, for the download-status endpoint.
 *
 * Deliberately not scoped to the caller: the cache is shared, so a job another
 * user started is the reason this caller's file is about to become available,
 * and reporting a bare "not cached" while that runs is what makes the UI look
 * like the file is gone. That same lack of scoping is why the repository only
 * counts a row that has been stamped recently — the client disables its own
 * request while a reconstruction is running, so a row nothing is working on
 * would take the feature away from everyone who asks about that cid.
 */
const getReconstructionByCid = async (
  cid: string,
): Promise<{
  state: 'running'
  downloadedBytes: string
  totalSize: string
  startedAt: Date | null
} | null> => {
  const active = await asyncDownloadsRepository.getActiveDownloadByCid(
    cid,
    config.params.asyncDownloadStaleAfterMs,
  )
  if (!active) {
    return null
  }

  return {
    state: 'running',
    downloadedBytes: active.downloadedBytes ?? '0',
    totalSize: active.fileSize ?? '0',
    startedAt: active.createdAt ?? null,
  }
}

export const AsyncDownloadsUseCases = {
  createDownload,
  getDownloadsByUser,
  getReconstructionByCid,
  updateProgress,
  updateStatus,
  dismissDownload,
  asyncDownload,
  setError,
  getDownloadById,
}
