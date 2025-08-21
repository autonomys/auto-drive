import { Router } from 'express'
import { pipeline } from 'stream'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { ObjectUseCases, UploadStatusUseCases } from '../../core/index.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleDownloadResponseHeaders } from '@autonomys/file-server'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'

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

    const getResult = await handleInternalError(
      ObjectUseCases.getRootObjects(
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
      ),
      'Failed to get root objects',
    )

    if (getResult.isErr()) {
      handleError(getResult.error, res)
      return
    }

    res.json(getResult.value)
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

    const getResult = await handleInternalError(
      ObjectUseCases.getSharedRoots(user, limitNumber, offsetNumber),
      'Failed to get shared roots',
    )

    if (getResult.isErr()) {
      handleError(getResult.error, res)
      return
    }

    res.json(getResult.value)
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

    const deleteResult = await handleInternalError(
      ObjectUseCases.getMarkedAsDeletedRoots(user, limitNumber, offsetNumber),
      'Failed to get deleted roots',
    )

    if (deleteResult.isErr()) {
      handleError(deleteResult.error, res)
      return
    }

    res.json(deleteResult.value)
  }),
)

objectController.get(
  '/search',
  asyncSafeHandler(async (req, res) => {
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

    const searchResult = await handleInternalError(
      ObjectUseCases.searchByCIDOrName(
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
      ),
      'Failed to search metadata',
    )

    if (searchResult.isErr()) {
      handleError(searchResult.error, res)
      return
    }

    res.json(searchResult.value)
  }),
)

objectController.get(
  '/:cid/summary',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const summaryResult = await handleInternalError(
      ObjectUseCases.getObjectSummaryByCID(cid),
      'Failed to get object summary',
    )

    if (summaryResult.isErr()) {
      handleError(summaryResult.error, res)
      return
    }

    const summary = summaryResult.value
    if (!summary) {
      res.status(404).json({
        error: 'Metadata not found',
      })
      return
    }

    res.json(summary)
  }),
)

objectController.get(
  '/:cid/metadata',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const metadataResult = await handleInternalError(
      ObjectUseCases.getMetadata(cid),
      'Failed to get metadata',
    )

    if (metadataResult.isErr()) {
      handleError(metadataResult.error, res)
      return
    }

    const metadata = metadataResult.value
    if (!metadata) {
      res.status(404).json({
        error: 'Metadata not found',
      })
      return
    }

    res.json(metadata)
  }),
)

objectController.get(
  '/:cid/status',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const statusResult = await handleInternalError(
      UploadStatusUseCases.getUploadStatus(cid),
      'Failed to get upload status',
    )

    if (statusResult.isErr()) {
      handleError(statusResult.error, res)
      return
    }

    res.json(statusResult.value)
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

    const shareResult = await handleInternalError(
      ObjectUseCases.shareObject(user, cid, publicId),
      'Failed to share object',
    )

    if (shareResult.isErr()) {
      handleError(shareResult.error, res)
      return
    }

    res.sendStatus(200)
  }),
)

objectController.post(
  '/:cid/delete',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { cid } = req.params

    const deleteResult = await handleInternalError(
      ObjectUseCases.markAsDeleted(user, cid),
      'Failed to delete object',
    )

    if (deleteResult.isErr()) {
      handleError(deleteResult.error, res)
      return
    }

    res.sendStatus(200)
  }),
)

objectController.post(
  '/:cid/restore',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { cid } = req.params

    const restoreResult = await handleInternalError(
      ObjectUseCases.restoreObject(user, cid),
      'Failed to restore object',
    )

    if (restoreResult.isErr()) {
      handleError(restoreResult.error, res)
      return
    }

    res.sendStatus(200)
  }),
)

objectController.get(
  '/:cid',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const objectResult = await handleInternalError(
      ObjectUseCases.getObjectInformation(cid),
      'Failed to get object information',
    )

    if (objectResult.isErr()) {
      handleError(objectResult.error, res)
      return
    }

    const objectInformation = objectResult.value
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

    const publishResult = await handleInternalError(
      ObjectUseCases.publishObject(user, cid),
      'Failed to publish object',
    )

    if (publishResult.isErr()) {
      handleError(publishResult.error, res)
      return
    }

    res.json({ result: publishResult.value.id })
  }),
)

objectController.get(
  '/:id/public',
  asyncSafeHandler(async (req, res) => {
    const { id } = req.params
    const blockingTags = req.query.blockObjectsWithTags
      ?.toString()
      .split(',')
      .filter((e) => e.trim())

    const downloadResult = await handleInternalErrorResult(
      ObjectUseCases.downloadPublishedObject(id, blockingTags),
      'Failed to download published object',
    )
    if (downloadResult.isErr()) {
      handleError(downloadResult.error, res)
      return
    }

    const {
      metadata,
      startDownload,
      byteRange: resultingByteRange,
    } = downloadResult.value
    if (!metadata) {
      res.status(404).json({
        error: 'Published object not found',
      })
      return
    }

    handleDownloadResponseHeaders(req, res, metadata, {
      byteRange: resultingByteRange,
    })

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

    const unpublishResult = await handleInternalErrorResult(
      ObjectUseCases.unpublishObject(user, cid),
      'Failed to unpublish object',
    )
    if (unpublishResult.isErr()) {
      handleError(unpublishResult.error, res)
      return
    }

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

    const banResult = await handleInternalErrorResult(
      ObjectUseCases.banObject(executor, cid),
      'Failed to ban object',
    )
    if (banResult.isErr()) {
      handleError(banResult.error, res)
      return
    }

    res.sendStatus(204)
  }),
)

objectController.post(
  '/:cid/report',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const reportResult = await handleInternalError(
      ObjectUseCases.reportObject(cid),
      'Failed to report object',
    )
    if (reportResult.isErr()) {
      handleError(reportResult.error, res)
      return
    }
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

    const dismissReportResult = await handleInternalErrorResult(
      ObjectUseCases.dismissReport(executor, cid),
      'Failed to dismiss report',
    )
    if (dismissReportResult.isErr()) {
      handleError(dismissReportResult.error, res)
      return
    }
    res.sendStatus(204)
  }),
)

objectController.get(
  '/to-be-reviewed/list',
  asyncSafeHandler(async (req, res) => {
    const { limit, offset } = req.query
    const limitNumber = limit ? parseInt(limit as string) : 100
    const offsetNumber = offset ? parseInt(offset as string) : 0

    const toBeReviewedList = await handleInternalError(
      ObjectUseCases.getToBeReviewedList(limitNumber, offsetNumber),
      'Failed to get to be reviewed list',
    )
    if (toBeReviewedList.isErr()) {
      handleError(toBeReviewedList.error, res)
      return
    }
    res.json(toBeReviewedList.value)
  }),
)

export { objectController }
