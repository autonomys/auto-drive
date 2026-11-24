import { Router } from 'express'
import { pipeline } from 'stream'
import {
  ApiKeyScope,
  ObjectSummary,
  PaginatedResult,
  User,
  isPartnerEndUser,
} from '@auto-drive/models'
import {
  allowPartnerEndUsers,
  handleAuth,
  requireApiKeyScope,
  tryAuthenticate,
} from '../../infrastructure/services/auth/express.js'
import {
  ObjectUseCases,
  OwnershipUseCases,
  UploadStatusUseCases,
} from '../../core/index.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleDownloadResponseHeaders } from '@autonomys/file-server'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'
import { handleError, ChunkNotFoundError, HttpError } from '../../errors/index.js'
import { sendMetricToVictoria } from '../../infrastructure/drivers/vmetrics.js'
import { config } from '../../config.js'

const logger = createLogger('http:controllers:object')

const objectController = Router()
objectController.use(requireApiKeyScope(ApiKeyScope.Files))

const withVisibleRowOwners = async (
  page: PaginatedResult<ObjectSummary>,
  viewer: User,
) => ({
  ...page,
  rows: await Promise.all(
    page.rows.map((row) =>
      OwnershipUseCases.withVisibleOwners(row, row.headCid, viewer),
    ),
  ),
})

// Partner end users, removed or not, list, look up, remove and restore their
// own objects, and nothing else here. Looking up any other object shows them
// only what it shows anyone (withVisibleOwners).
const allowEndUsers = allowPartnerEndUsers({ removed: true })

objectController.get(
  '/roots',
  allowEndUsers,
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
        // Partner end users only ever get their own.
        scope === 'user' || isPartnerEndUser(user)
          ? {
              user,
              scope: 'user',
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

    res.json(await withVisibleRowOwners(getResult.value, user))
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

    res.json(await withVisibleRowOwners(getResult.value, user))
  }),
)

objectController.get(
  '/roots/deleted',
  allowEndUsers,
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

    res.json(await withVisibleRowOwners(deleteResult.value, user))
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
  allowEndUsers,
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const [summaryResult, viewer] = await Promise.all([
      handleInternalError(
        ObjectUseCases.getObjectSummaryByCID(cid),
        'Failed to get object summary',
      ),
      tryAuthenticate(req),
    ])

    if (summaryResult.isErr()) {
      handleError(summaryResult.error, res)
      return
    }

    const summary = summaryResult.value
    if (!summary || (await ObjectUseCases.isObjectDeleted(cid))) {
      res.status(404).json({
        error: 'Metadata not found',
      })
      return
    }

    // The owners depend on the credentials, so shared caches must not keep this
    res.set('Cache-Control', 'private')
    res.json(await OwnershipUseCases.withVisibleOwners(summary, cid, viewer))
  }),
)

objectController.get(
  '/:cid/metadata',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const metadataResult = await handleInternalErrorResult(
      ObjectUseCases.getMetadata(cid),
      'Failed to get metadata',
    )

    if (metadataResult.isErr()) {
      handleError(metadataResult.error, res)
      return
    }

    // A removed object must not be discoverable by its CID.
    if (await ObjectUseCases.isObjectDeleted(cid)) {
      res.status(404).json({
        error: `Object with cid=${cid} not found`,
      })
      return
    }

    const metadata = metadataResult.value

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

    // A removed object must not be discoverable by its CID.
    if (await ObjectUseCases.isObjectDeleted(cid)) {
      res.status(404).json({
        error: `Object with cid=${cid} not found`,
      })
      return
    }

    res.json(statusResult.value)
  }),
)

objectController.post(
  '/:cid/share',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { publicId } = req.body
    const { cid } = req.params

    if (!publicId) {
      res.status(400).json({
        error: 'Missing `publicId` in request body',
      })
      return
    }

    const shareResult = await handleInternalErrorResult(
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

// Only an owner may remove or restore an object (ObjectUseCases).
objectController.post(
  '/:cid/delete',
  allowEndUsers,
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { cid } = req.params

    const deleteResult = await handleInternalErrorResult(
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
  allowEndUsers,
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { cid } = req.params

    const restoreResult = await handleInternalErrorResult(
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
  allowEndUsers,
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const [objectResult, viewer] = await Promise.all([
      handleInternalError(
        ObjectUseCases.getObjectInformation(cid),
        'Failed to get object information',
      ),
      tryAuthenticate(req),
    ])

    if (objectResult.isErr()) {
      handleError(objectResult.error, res)
      return
    }

    const objectInformation = objectResult.value
    if (!objectInformation || (await ObjectUseCases.isObjectDeleted(cid))) {
      res.status(404).json({
        error: 'Object not found',
      })
      return
    }

    const [withOwners, publishedObjectId] = await Promise.all([
      OwnershipUseCases.withVisibleOwners(objectInformation, cid, viewer),
      ObjectUseCases.getPublishedObjectId(cid, viewer),
    ])

    // The owners and the public link depend on the credentials, so shared
    // caches must not keep this
    res.set('Cache-Control', 'private')
    res.json({ ...withOwners, publishedObjectId })
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

    // Resolve the stream before staging headers, so an unresolvable object
    // yields a real status instead of a mid-stream reset (see issue #815 and
    // the S3 GetObject handler, which does the same).
    let stream
    try {
      stream = await startDownload()
    } catch (error) {
      if (error instanceof ChunkNotFoundError) {
        logger.warn(
          'Published object is momentarily unresolvable (id=%s, chunkCid=%s)',
          id,
          error.cid,
        )
      }
      if (error instanceof HttpError && !res.headersSent) {
        handleError(error, res)
        return
      }
      throw error
    }

    handleDownloadResponseHeaders(req, res, metadata, {
      byteRange: resultingByteRange,
    })

    pipeline(stream, res, (err) => {
      if (err) {
        if (res.headersSent) return
        logger.error('Error streaming data (id=%s)', id, err)
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
  '/:cid/unban',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    const executor = await handleAuth(req, res)
    if (!executor) {
      return
    }

    const unbanResult = await handleInternalErrorResult(
      ObjectUseCases.unbanObject(executor, cid),
      'Failed to unban object',
    )
    if (unbanResult.isErr()) {
      handleError(unbanResult.error, res)
      return
    }

    res.sendStatus(204)
  }),
)

objectController.post(
  '/:cid/report',
  asyncSafeHandler(async (req, res) => {
    const { cid } = req.params

    logger.info('Reporting object', { cid })
    sendMetricToVictoria({
      measurement: 'object_report',
      tags: {
        chain: config.monitoring.metricEnvironmentTag,
      },
      fields: {
        count: 1,
      },
    })

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
    const executor = await handleAuth(req, res)
    if (!executor) {
      return
    }

    const { limit, offset } = req.query
    const limitNumber = limit ? parseInt(limit as string) : 100
    const offsetNumber = offset ? parseInt(offset as string) : 0

    const toBeReviewedList = await handleInternalErrorResult(
      ObjectUseCases.getToBeReviewedList(executor, limitNumber, offsetNumber),
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
