import { Router } from 'express'
import { pipeline } from 'stream'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import {
  AsyncDownloadsUseCases,
  DownloadUseCase,
} from '../../core/downloads/index.js'
import {
  handleAuth,
  handleOptionalAuth,
} from '../../infrastructure/services/auth/express.js'
import { handleDownloadResponseHeaders } from '../../shared/httpHandlers/download.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { downloadService } from '../../infrastructure/services/download/index.js'
import { getByteRange } from '../../shared/utils/http.js'
import { handleError } from '../../errors/index.js'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'

const logger = createLogger('http:controllers:download')

const downloadController = Router()

downloadController.get(
  '/:cid/status',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params
    const checkStatusResult = await handleInternalError(
      downloadService.status(cid),
      'Failed to get download status',
    )

    if (checkStatusResult.isErr()) {
      handleError(checkStatusResult.error, res)
      return
    }
    res.json({ status: checkStatusResult.value })
  }),
)

downloadController.post(
  '/async/:cid',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const createDownloadResult = await handleInternalErrorResult(
      AsyncDownloadsUseCases.createDownload(user, cid),
      'Failed to create download',
    )
    if (createDownloadResult.isErr()) {
      handleError(createDownloadResult.error, res)
      return
    }

    res.json(createDownloadResult.value)
  }),
)

downloadController.post(
  '/async/:downloadId/dismiss',
  asyncSafeHandler(async (req, res) => {
    const { downloadId } = req.params
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const dismissalResult = await handleInternalError(
      AsyncDownloadsUseCases.dismissDownload(user, downloadId),
      'Failed to dismiss download',
    )
    if (dismissalResult.isErr()) {
      handleError(dismissalResult.error, res)
      return
    }

    res.json(dismissalResult.value)
  }),
)

downloadController.get(
  '/:cid',
  asyncSafeHandler(async (req, res) => {
    try {
      const { cid } = req.params
      const { blockObjectsWithTags } = req.query

      const blockingTags = blockObjectsWithTags
        ?.toString()
        .split(',')
        .filter((e) => e.trim())
      const byteRange = getByteRange(req)
      const downloadOptions = {
        blockingTags,
        byteRange,
      }

      const optionalAuthResult = await handleOptionalAuth(req, res)
      if (!optionalAuthResult) {
        return
      }

      logger.info('Attempting to retrieve data for metadataCid: %s', cid)

      const user =
        typeof optionalAuthResult === 'boolean' ? null : optionalAuthResult

      const downloadResultPromise = !user
        ? DownloadUseCase.downloadObjectByAnonymous(cid, downloadOptions)
        : DownloadUseCase.downloadObjectByUser(user, cid, downloadOptions)

      const downloadResult = await handleInternalErrorResult(
        downloadResultPromise,
        'Failed to download object',
      )
      if (downloadResult.isErr()) {
        handleError(downloadResult.error, res)
        return
      }

      const {
        metadata,
        byteRange: resultingByteRange,
        startDownload,
      } = downloadResult.value
      handleDownloadResponseHeaders(req, res, metadata, resultingByteRange)

      pipeline(await startDownload(), res, (err: Error | null) => {
        if (err) {
          if (res.headersSent) return
          logger.error('Error streaming data', err)
          res.status(500).json({
            error: 'Failed to stream data',
            details: err.message,
          })
        }
      })
    } catch (error: unknown) {
      logger.error('Error retrieving data', error)
      res.status(500).json({
        error: 'Failed to retrieve data',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }),
)

downloadController.get(
  '/async/@me',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const asyncDownloads = await handleInternalError(
      AsyncDownloadsUseCases.getDownloadsByUser(user),
      'Failed to get downloads by user',
    )
    if (asyncDownloads.isErr()) {
      handleError(asyncDownloads.error, res)
      return
    }

    res.json(asyncDownloads.value)
  }),
)

downloadController.get(
  '/async/:downloadId',
  asyncSafeHandler(async (req, res) => {
    const { downloadId } = req.params
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const getDownloadResult = await handleInternalErrorResult(
      AsyncDownloadsUseCases.getDownloadById(user, downloadId),
      'Failed to get download by id',
    )
    if (getDownloadResult.isErr()) {
      handleError(getDownloadResult.error, res)
      return
    }

    res.json(getDownloadResult.value)
  }),
)

export { downloadController }
