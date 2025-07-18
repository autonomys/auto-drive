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

const logger = createLogger('http:controllers:download')

const downloadController = Router()

downloadController.get(
  '/:cid/status',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params
    const status = await downloadService.status(cid)
    res.json({ status })
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

    const download = await AsyncDownloadsUseCases.createDownload(user, cid)

    res.json(download)
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

    const download = await AsyncDownloadsUseCases.dismissDownload(
      user,
      downloadId,
    )

    res.json(download)
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

      const {
        metadata,
        startDownload,
        byteRange: resultingByteRange,
      } = !user
        ? await DownloadUseCase.downloadObjectByAnonymous(cid, downloadOptions)
        : await DownloadUseCase.downloadObjectByUser(user, cid, downloadOptions)

      if (!metadata) {
        res.status(404).json({
          error: 'Metadata not found',
        })
        return
      }

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

    const asyncDownloads = await AsyncDownloadsUseCases.getDownloadsByUser(user)

    res.json(asyncDownloads)
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

    const asyncDownload = await AsyncDownloadsUseCases.getDownloadById(
      user,
      downloadId,
    )

    res.json(asyncDownload)
  }),
)

export { downloadController }
