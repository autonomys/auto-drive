import { Router } from 'express'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { DeletionUseCases } from '../../core/users/deletion.js'
import { handleInternalErrorResult } from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'

export const deletionController = Router()

// ---------------------------------------------------------------------------
// GET /deletion/admin/audit/:publicId
// Admin-only: returns the anonymisation audit log for a user.
// ---------------------------------------------------------------------------

deletionController.get(
  '/admin/audit/:publicId',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      DeletionUseCases.getAuditLog(user, req.params.publicId),
      'Failed to get deletion audit log',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)

// ---------------------------------------------------------------------------
// GET /deletion/admin/stats
// Admin-only: returns aggregate deletion statistics.
// ---------------------------------------------------------------------------

deletionController.get(
  '/admin/stats',
  asyncSafeHandler(async (req, res) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const result = await handleInternalErrorResult(
      DeletionUseCases.getStats(user),
      'Failed to get deletion stats',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    res.status(200).json(result.value)
  }),
)
