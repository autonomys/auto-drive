import { Router } from 'express'
import { pipeline } from 'stream'
import { handleAuth, handleOptionalAuth } from '../../services/auth/express.js'
import { ObjectUseCases, UploadStatusUseCases } from '../../useCases/index.js'
import { createLogger } from '../../drivers/logger.js'
import { asyncSafeHandler } from '../../utils/express.js'
import { handleDownloadResponseHeaders } from '../../services/download/express.js'
import { getByteRange } from '../../utils/http.js'
import { DownloadUseCase } from '../../useCases/objects/downloads.js'

const logger = createLogger('http:controllers:object')

const objectController = Router()

objectController.get(
  '/roots',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    const { scope, limit, offset } = req.query
    if (!user) {
      return
    }

    const limitNumber = limit ? parseInt(limit as string) : undefined
    const offsetNumber = offset ? parseInt(offset as string) : undefined

    const roots = await ObjectUseCases.getRootObjects(
      user && scope === 'user'
        ? {
            user,
            scope,
          }
        : {
            scope: 'global',
          },
      limitNumber,
      offsetNumber,
    )
    res.json(roots)
  }),
)

objectController.get(
  '/roots/shared',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { limit, offset } = req.query
    const limitNumber = limit ? parseInt(limit as string) : undefined
    const offsetNumber = offset ? parseInt(offset as string) : undefined

    const sharedRoots = await ObjectUseCases.getSharedRoots(
      user,
      limitNumber,
      offsetNumber,
    )

    res.json(sharedRoots)
  }),
)

objectController.get(
  '/roots/deleted',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { limit, offset } = req.query
    const limitNumber = limit ? parseInt(limit as string) : undefined
    const offsetNumber = offset ? parseInt(offset as string) : undefined

    const deletedRoots = await ObjectUseCases.getMarkedAsDeletedRoots(
      user,
      limitNumber,
      offsetNumber,
    )

    res.json(deletedRoots)
  }),
)

objectController.get(
  '/search',
  asyncSafeHandler(async (req, res) => {
    try {
      const { scope, cid } = req.query

      const user = await handleAuth(req, res)
      if (!user) {
        return
      }

      if (typeof cid !== 'string') {
        res.status(400).json({
          error: 'Missing or invalid cid value',
        })
        return
      }

      const limit = req.query.limit
        ? parseInt(req.query.limit as string)
        : undefined
      const results = await ObjectUseCases.searchByCIDOrName(
        cid,
        limit,
        user && scope === 'user'
          ? {
              user,
              scope,
            }
          : {
              scope: 'global',
            },
      )
      res.json(results)
    } catch (error: unknown) {
      logger.error('Error searching metadata:', error)
      res.status(500).json({
        error: 'Failed to search metadata',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }),
)

objectController.get(
  '/:cid/summary',
  asyncSafeHandler(async (req, res) => {
    try {
      const { cid } = req.params
      const summary = await ObjectUseCases.getObjectSummaryByCID(cid)
      if (!summary) {
        res.status(404).json({
          error: 'Metadata not found',
        })
        return
      }

      res.json(summary)
    } catch (error: unknown) {
      logger.error('Error retrieving metadata:', error)
      res.status(500).json({
        error: 'Failed to retrieve metadata',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }),
)

objectController.get(
  '/:cid/metadata',
  asyncSafeHandler(async (req, res) => {
    try {
      const { cid } = req.params
      const metadata = await ObjectUseCases.getMetadata(cid)
      if (!metadata) {
        res.status(404).json({
          error: 'Metadata not found',
        })
        return
      }

      res.json(metadata)
    } catch (error: unknown) {
      logger.error('Error retrieving metadata:', error)
      res.status(500).json({
        error: 'Failed to retrieve metadata',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }),
)

objectController.get(
  '/:cid/status',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const objectInformation = await UploadStatusUseCases.getUploadStatus(cid)
    res.json(objectInformation)
  }),
)

objectController.post(
  '/:cid/share',
  asyncSafeHandler(async (req, res) => {
    const { publicId } = req.body
    const { cid } = req.params

    if (!publicId) {
      res.status(400).json({
        error: 'Missing `publicId` in request body',
      })
      return
    }

    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    try {
      await ObjectUseCases.shareObject(user, cid, publicId)
      res.sendStatus(200)
    } catch (error: unknown) {
      logger.error('Error sharing object:', error)
      res.status(500).json({
        error: 'Failed to share object',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }),
)

// Deprecated: Use /downloads/:cid instead
objectController.get(
  '/:cid/download',
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

      pipeline(await startDownload(), res, (err) => {
        if (err) {
          if (res.headersSent) return
          logger.error('Error streaming data:', err)
          res.status(500).json({
            error: 'Failed to stream data',
            details: err.message,
          })
        }
      })
    } catch (error: unknown) {
      logger.error('Error retrieving data:', error)
      res.status(500).json({
        error: 'Failed to retrieve data',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }),
)

objectController.post(
  '/:cid/delete',
  asyncSafeHandler(async (req, res) => {
    try {
      const user = await handleAuth(req, res)
      if (!user) {
        return
      }

      const { cid } = req.params

      await ObjectUseCases.markAsDeleted(user, cid)

      res.sendStatus(200)
    } catch (error: unknown) {
      logger.error('Error deleting object:', error)
      res.status(500).json({
        error: 'Failed to delete object',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }),
)

objectController.post(
  '/:cid/restore',
  asyncSafeHandler(async (req, res) => {
    try {
      const user = await handleAuth(req, res)
      if (!user) {
        return
      }

      const { cid } = req.params

      await ObjectUseCases.restoreObject(user, cid)

      res.sendStatus(200)
    } catch (error: unknown) {
      logger.error('Error deleting object:', error)
      res.status(500).json({
        error: 'Failed to delete object',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }),
)

objectController.get(
  '/:cid',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const objectInformation = await ObjectUseCases.getObjectInformation(cid)

    if (!objectInformation) {
      res.status(404).json({
        error: 'Object not found',
      })
      return
    }

    res.json(objectInformation)
  }),
)

objectController.post(
  '/:cid/publish',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const publishedObject = await ObjectUseCases.publishObject(user, cid)

    res.json({ result: publishedObject.id })
  }),
)

objectController.get(
  '/:id/public',
  asyncSafeHandler(async (req, res) => {
    try {
      const { id } = req.params
      const blockingTags = req.query.blockObjectsWithTags
        ?.toString()
        .split(',')
        .filter((e) => e.trim())

      const {
        metadata,
        startDownload,
        byteRange: resultingByteRange,
      } = await ObjectUseCases.downloadPublishedObject(id, blockingTags)
      if (!metadata) {
        res.status(404).json({
          error: 'Published object not found',
        })
        return
      }

      handleDownloadResponseHeaders(req, res, metadata, resultingByteRange)

      pipeline(await startDownload(), res, (err) => {
        if (err) {
          if (res.headersSent) return
          logger.error('Error streaming data:', err)
          res.status(500).json({
            error: 'Failed to stream data',
            details: err.message,
          })
        }
      })
    } catch (error: unknown) {
      logger.error('Error retrieving data:', error)
      res.status(500).json({
        error: 'Failed to retrieve data',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }),
)

objectController.post(
  '/:cid/unpublish',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    await ObjectUseCases.unpublishObject(user, cid)

    res.sendStatus(204)
  }),
)

objectController.post(
  '/:cid/ban',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const executor = await handleAuth(req, res)
    if (!executor) {
      return
    }

    await ObjectUseCases.banObject(executor, cid)

    res.sendStatus(204)
  }),
)

objectController.post(
  '/:cid/report',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const executor = await handleAuth(req, res)
    if (!executor) {
      return
    }

    await ObjectUseCases.reportObject(cid)
    res.sendStatus(204)
  }),
)

objectController.post(
  '/:cid/dismiss-report',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const executor = await handleAuth(req, res)
    if (!executor) {
      return
    }

    await ObjectUseCases.dismissReport(executor, cid)
    res.sendStatus(204)
  }),
)

objectController.get(
  '/to-be-reviewed/list',
  asyncSafeHandler(async (req, res) => {
    const { limit, offset } = req.query
    const limitNumber = limit ? parseInt(limit as string) : 100
    const offsetNumber = offset ? parseInt(offset as string) : 0

    const toBeReviewedList = await ObjectUseCases.getToBeReviewedList(
      limitNumber,
      offsetNumber,
    )
    res.json(toBeReviewedList)
  }),
)

export { objectController }
