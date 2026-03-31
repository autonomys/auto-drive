import { Router } from 'express'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { TouUseCases } from '../../core/tou.js'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'
import { TouChangeType } from '@auto-drive/models'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('http:controllers:tou')

export const touController = Router()

// ---------------------------------------------------------------------------
// GET /tou/status — user-facing: check ToU acceptance status
// ---------------------------------------------------------------------------

touController.get(
  '/status',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) return

    const result = await handleInternalError(
      TouUseCases.getTouStatus(user),
      'Failed to get ToU status',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// POST /tou/accept — user-facing: accept current active version
// ---------------------------------------------------------------------------

touController.post(
  '/accept',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) return

    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      null

    const result = await handleInternalErrorResult(
      TouUseCases.acceptCurrentVersion(user, ipAddress),
      'Failed to accept ToU',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    logger.debug('User %s accepted ToU', user.publicId)
    res.status(204).send()
  }),
)

// ---------------------------------------------------------------------------
// GET /tou/admin — list all versions
// ---------------------------------------------------------------------------

touController.get(
  '/admin',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) return

    const result = await handleInternalErrorResult(
      TouUseCases.getAllVersions(user),
      'Failed to get ToU versions',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// POST /tou/admin — create draft version
// ---------------------------------------------------------------------------

touController.post(
  '/admin',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) return

    const { versionLabel, effectiveDate, contentUrl, changeType, adminNotes } =
      req.body

    if (!versionLabel || !effectiveDate || !contentUrl) {
      res
        .status(400)
        .json({ error: 'versionLabel, effectiveDate, and contentUrl are required' })
      return
    }

    if (
      changeType &&
      changeType !== TouChangeType.Material &&
      changeType !== TouChangeType.NonMaterial
    ) {
      res.status(400).json({ error: 'Invalid changeType' })
      return
    }

    const result = await handleInternalErrorResult(
      TouUseCases.createTouVersion(user, {
        versionLabel,
        effectiveDate: new Date(effectiveDate),
        contentUrl,
        changeType: changeType || TouChangeType.Material,
        adminNotes: adminNotes || null,
      }),
      'Failed to create ToU version',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(201).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// PUT /tou/admin/:id — update draft version
// ---------------------------------------------------------------------------

touController.put(
  '/admin/:id',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) return

    const { versionLabel, effectiveDate, contentUrl, changeType, adminNotes } =
      req.body

    const result = await handleInternalErrorResult(
      TouUseCases.updateTouVersion(user, req.params.id, {
        versionLabel,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
        contentUrl,
        changeType,
        adminNotes: adminNotes !== undefined ? adminNotes : undefined,
      }),
      'Failed to update ToU version',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// POST /tou/admin/:id/promote — promote draft to pending
// ---------------------------------------------------------------------------

touController.post(
  '/admin/:id/promote',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) return

    const { overrideNotice, overrideReason } = req.body || {}

    const result = await handleInternalErrorResult(
      TouUseCases.promoteToPending(
        user,
        req.params.id,
        overrideNotice,
        overrideReason,
      ),
      'Failed to promote ToU version',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// POST /tou/admin/:id/activate — manual early activation
// ---------------------------------------------------------------------------

touController.post(
  '/admin/:id/activate',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) return

    const result = await handleInternalErrorResult(
      TouUseCases.activateVersion(user, req.params.id),
      'Failed to activate ToU version',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// POST /tou/admin/:id/archive — archive version
// ---------------------------------------------------------------------------

touController.post(
  '/admin/:id/archive',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) return

    const result = await handleInternalErrorResult(
      TouUseCases.archiveVersion(user, req.params.id),
      'Failed to archive ToU version',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// GET /tou/admin/:id/stats — acceptance statistics
// ---------------------------------------------------------------------------

touController.get(
  '/admin/:id/stats',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) return

    const result = await handleInternalErrorResult(
      TouUseCases.getVersionWithStats(user, req.params.id),
      'Failed to get ToU version stats',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)
