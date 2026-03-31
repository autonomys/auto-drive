import { Router } from 'express'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { BannersUseCases } from '../../core/banners.js'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'
import { BannerInteractionType } from '@auto-drive/models'

export const bannersController = Router()

// ---------------------------------------------------------------------------
// GET /banners/active
// Returns active banners for the authenticated user, filtered by interactions.
// ---------------------------------------------------------------------------

bannersController.get(
  '/active',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalError(
      BannersUseCases.getActiveBannersForUser(user),
      'Failed to get active banners',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// POST /banners/:id/interact
// Records a user interaction (acknowledge or dismiss) with a banner.
// ---------------------------------------------------------------------------

bannersController.post(
  '/:id/interact',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { type } = req.body as { type: string }
    if (
      type !== BannerInteractionType.Acknowledged &&
      type !== BannerInteractionType.Dismissed
    ) {
      res.status(400).json({ error: 'Invalid interaction type' })
      return
    }

    const result = await handleInternalErrorResult(
      BannersUseCases.recordInteraction(user, req.params.id, type),
      'Failed to record banner interaction',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(204).send()
  }),
)

// ---------------------------------------------------------------------------
// GET /banners/admin
// Admin-only: returns all banners.
// ---------------------------------------------------------------------------

bannersController.get(
  '/admin',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      BannersUseCases.getAllBanners(user),
      'Failed to get all banners',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// POST /banners/admin
// Admin-only: create a new banner.
// ---------------------------------------------------------------------------

bannersController.post(
  '/admin',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const {
      title,
      body,
      criticality,
      dismissable,
      requiresAcknowledgement,
      displayStart,
      displayEnd,
      active,
    } = req.body

    const result = await handleInternalErrorResult(
      BannersUseCases.createBanner(user, {
        title,
        body,
        criticality,
        dismissable: dismissable ?? true,
        requiresAcknowledgement: requiresAcknowledgement ?? false,
        displayStart: displayStart ? new Date(displayStart) : new Date(),
        displayEnd: displayEnd ? new Date(displayEnd) : null,
        active: active ?? true,
      }),
      'Failed to create banner',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(201).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// PUT /banners/admin/:id
// Admin-only: update an existing banner.
// ---------------------------------------------------------------------------

bannersController.put(
  '/admin/:id',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const {
      title,
      body,
      criticality,
      dismissable,
      requiresAcknowledgement,
      displayStart,
      displayEnd,
      active,
    } = req.body

    const result = await handleInternalErrorResult(
      BannersUseCases.updateBanner(user, req.params.id, {
        title,
        body,
        criticality,
        dismissable,
        requiresAcknowledgement,
        displayStart: displayStart ? new Date(displayStart) : undefined,
        displayEnd: displayEnd !== undefined
          ? displayEnd
            ? new Date(displayEnd)
            : null
          : undefined,
        active,
      }),
      'Failed to update banner',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// POST /banners/admin/:id/toggle
// Admin-only: activate or deactivate a banner.
// ---------------------------------------------------------------------------

bannersController.post(
  '/admin/:id/toggle',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { active } = req.body as { active: boolean }

    const result = await handleInternalErrorResult(
      BannersUseCases.toggleBannerActive(user, req.params.id, active),
      'Failed to toggle banner',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// GET /banners/admin/:id/stats
// Admin-only: get banner with acknowledgement/dismissal stats.
// ---------------------------------------------------------------------------

bannersController.get(
  '/admin/:id/stats',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      BannersUseCases.getBannerWithStats(user, req.params.id),
      'Failed to get banner stats',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)
