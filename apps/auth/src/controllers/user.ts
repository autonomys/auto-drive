import { Router, Request, Response } from 'express'
import {
  handleAdminAuth,
  handleAuth,
  handleAuthIgnoreOnboarding,
  refreshAccessToken,
} from '../services/authManager/express.js'
import { UsersUseCases } from '../useCases/index.js'
import { DeletionUseCases } from '../useCases/deletion.js'
import { ApiKeysUseCases } from '../useCases/apikeys.js'
import { ApiKeyError } from '../errors/apikeys.js'
import { DeletionRequestStatus, UserRole } from '@auto-drive/models'
import { CustomJWTAuth } from '../services/authManager/providers/custom.js'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('controllers:user')

const userController = Router()

userController.post('/@me/onboard', async (req: Request, res: Response) => {
  const user = await handleAuthIgnoreOnboarding(req, res)
  if (!user) {
    return
  }

  try {
    const onboardedUser = await UsersUseCases.onboardUser(user)
    res.json(onboardedUser)
  } catch (error) {
    logger.error(error)
    res.status(500).json({
      error: 'Failed to onboard user',
    })
  }
})

userController.post('/@me/accessToken', async (req: Request, res: Response) => {
  const user = await handleAuthIgnoreOnboarding(req, res)
  if (!user) {
    return
  }

  const { accessToken, refreshToken } =
    await CustomJWTAuth.createSessionTokens(user)

  res
    .cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    })
    .json({ accessToken })
})

userController.post(
  '/@me/refreshToken',
  async (req: Request, res: Response) => {
    try {
      const refreshToken =
        req.headers.cookie?.match(/refreshToken=([^;]+)/)?.[1]
      if (!refreshToken) {
        res.status(401).json({
          error: 'Unauthorized',
        })
        return
      }

      const accessToken = await refreshAccessToken(refreshToken)

      res.json({ accessToken })
    } catch (error) {
      logger.error(error)
      res.status(500).json({ error: 'Failed to refresh access token' })
      return
    }
  },
)

userController.delete(
  '/@me/invalidateToken',
  async (req: Request, res: Response) => {
    const token = req.body.token

    if (typeof token !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid attribute `token` in body',
      })
      return
    }

    await CustomJWTAuth.invalidateRefreshToken(token)

    res.sendStatus(200)
  },
)

userController.get('/@me', async (req: Request, res: Response) => {
  const user = await handleAuthIgnoreOnboarding(req, res)
  if (!user) {
    logger.warn('User not found')
    return
  }

  try {
    const userInfo = await UsersUseCases.getUserWithOrganization(user)

    res.json(userInfo)
  } catch (error) {
    logger.error(error)
    res.status(500).json({
      error: 'Failed to get user info',
    })
    return
  }
})

userController.get('/@me/apiKeys', async (req: Request, res: Response) => {
  const user = await handleAuth(req, res)
  if (!user) {
    return
  }

  try {
    const apiKeys = await ApiKeysUseCases.getApiKeysByUser(user)

    res.json(apiKeys)
  } catch (error) {
    logger.error(error)
    res.status(500).json({
      error: 'Failed to get API keys',
    })
    return
  }
})

const parseCreateApiKeyBody = (
  body: unknown,
): { name: string | null; expiresAt: Date | null } | { error: string } => {
  // Allow callers to POST with no body at all — creates an unnamed,
  // never-expiring key.
  if (body === undefined || body === null) {
    return { name: null, expiresAt: null }
  }
  if (typeof body !== 'object') {
    return { error: 'Request body must be a JSON object' }
  }
  const { name, expiresAt } = body as {
    name?: unknown
    expiresAt?: unknown
  }

  let parsedName: string | null = null
  if (name !== undefined && name !== null) {
    if (typeof name !== 'string') {
      return { error: 'Attribute `name` must be a string' }
    }
    const trimmed = name.trim()
    if (trimmed.length > 64) {
      return {
        error: 'Attribute `name` must be 64 characters or fewer',
      }
    }
    parsedName = trimmed.length === 0 ? null : trimmed
  }

  let parsedExpiresAt: Date | null = null
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    if (typeof expiresAt !== 'string') {
      return { error: 'Attribute `expiresAt` must be an ISO-8601 string' }
    }
    const parsed = new Date(expiresAt)
    if (Number.isNaN(parsed.getTime())) {
      return { error: 'Attribute `expiresAt` is not a valid date' }
    }
    if (parsed.getTime() <= Date.now()) {
      return { error: 'Attribute `expiresAt` must be in the future' }
    }
    parsedExpiresAt = parsed
  }

  return { name: parsedName, expiresAt: parsedExpiresAt }
}

userController.post(
  '/@me/apiKeys/create',
  async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const parsed = parseCreateApiKeyBody(req.body)
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error })
      return
    }

    try {
      const apiKey = await ApiKeysUseCases.createApiKey(user, {
        name: parsed.name,
        expiresAt: parsed.expiresAt,
      })

      res.json(apiKey)
    } catch (error) {
      if (error instanceof ApiKeyError) {
        res.status(error.httpStatus).json({ error: error.message })
      } else {
        logger.error(error)
        res.status(500).json({ error: 'Failed to create API key' })
      }
      return
    }
  },
)

userController.delete(
  '/@me/apiKeys/:id',
  async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { id } = req.params

    try {
      await ApiKeysUseCases.deleteApiKey(user, id)

      res.sendStatus(200)
    } catch (error) {
      if (error instanceof ApiKeyError) {
        res.status(error.httpStatus).json({ error: error.message })
      } else {
        logger.error(error)
        res.status(500).json({ error: 'Failed to delete API key' })
      }
      return
    }
  },
)

userController.post('/admin/add', async (req: Request, res: Response) => {
  const user = await handleAuth(req, res)
  if (!user) {
    return
  }

  const { publicId } = req.body

  if (typeof publicId !== 'string') {
    res.status(400).json({
      error: 'Missing or invalid attribute `publicId` in body',
    })
    return
  }

  try {
    await UsersUseCases.updateRole(user, publicId, UserRole.Admin)

    res.sendStatus(200)
  } catch (error) {
    logger.error(error)
    res.status(500).json({
      error: 'Failed to add user to admins',
    })
    return
  }
})

userController.post('/admin/remove', async (req: Request, res: Response) => {
  const user = await handleAuth(req, res)
  if (!user) {
    return
  }

  const { publicId } = req.body

  if (typeof publicId !== 'string') {
    res.status(400).json({
      error: 'Missing or invalid attribute `publicId` in body',
    })
    return
  }

  try {
    await UsersUseCases.updateRole(user, publicId, UserRole.User)

    res.sendStatus(200)
  } catch (error) {
    logger.error(error)
    res.status(500).json({
      error: 'Failed to remove user from admins',
    })
    return
  }
})

userController.get('/list', async (req: Request, res: Response) => {
  const user = await handleAuth(req, res)
  if (!user) {
    return
  }

  try {
    const page = req.query.page ? parseInt(req.query.page as string) : undefined
    const limit = req.query.limit
      ? parseInt(req.query.limit as string)
      : undefined

    // Validate pagination parameters
    if (page !== undefined && (isNaN(page) || page < 0)) {
      res.status(400).json({ error: 'Invalid page parameter' })

      return
    }

    if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
      res.status(400).json({
        error: 'Invalid limit parameter (must be a number between 1 and 100)',
      })
      return
    }

    const result = await UsersUseCases.getPaginatedUserList(user, page, limit)

    res.json(result)
  } catch (error) {
    logger.error(error)
    res.status(500).json({
      error: 'Failed to get user list',
    })
    return
  }
})

userController.post('/batch', async (req: Request, res: Response) => {
  const isAdmin = await handleAdminAuth(req, res)
  if (!isAdmin) {
    return
  }

  const { publicIds } = req.body
  if (!Array.isArray(publicIds)) {
    res.status(400).json({ error: 'publicIds must be an array' })
    return
  }

  try {
    const users = await UsersUseCases.getUsersWithOrganizations(publicIds)
    res.json(users)
  } catch (error) {
    logger.error(error)
    res.status(500).json({ error: 'Failed to get users' })
  }
})

// --- Account Deletion Endpoints ---

userController.post('/@me/deletion', async (req: Request, res: Response) => {
  const user = await handleAuth(req, res)
  if (!user) {
    return
  }

  try {
    const { reason } = req.body ?? {}
    const request = await DeletionUseCases.requestDeletion(
      user,
      typeof reason === 'string' ? reason : undefined,
    )
    res.status(201).json(request)
  } catch (error) {
    logger.error(error)
    res.status(500).json({ error: 'Failed to request account deletion' })
  }
})

userController.delete('/@me/deletion', async (req: Request, res: Response) => {
  const user = await handleAuth(req, res)
  if (!user) {
    return
  }

  try {
    const result = await DeletionUseCases.cancelDeletion(user)
    if (!result) {
      res.status(404).json({ error: 'No pending deletion request found' })
      return
    }
    res.json(result)
  } catch (error) {
    logger.error(error)
    res.status(500).json({ error: 'Failed to cancel deletion' })
  }
})

userController.get('/@me/deletion', async (req: Request, res: Response) => {
  const user = await handleAuth(req, res)
  if (!user) {
    return
  }

  try {
    const request = await DeletionUseCases.getDeletionStatus(user)
    res.json(request)
  } catch (error) {
    logger.error(error)
    res.status(500).json({ error: 'Failed to get deletion status' })
  }
})

// --- Admin Deletion Endpoints ---

userController.get(
  '/admin/deletions',
  async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    try {
      const status = req.query.status as DeletionRequestStatus | undefined
      const requests = await DeletionUseCases.getAllDeletionRequests(user, status)
      res.json(requests)
    } catch (error) {
      logger.error(error)
      res.status(500).json({ error: 'Failed to get deletion requests' })
    }
  },
)

userController.post(
  '/admin/deletions/:id/notes',
  async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }

    const { notes } = req.body
    if (typeof notes !== 'string') {
      res.status(400).json({ error: 'Missing or invalid attribute `notes` in body' })
      return
    }

    try {
      const request = await DeletionUseCases.updateAdminNotes(
        user,
        req.params.id,
        notes,
      )
      res.json(request)
    } catch (error) {
      logger.error(error)
      res.status(500).json({ error: 'Failed to update admin notes' })
    }
  },
)

// --- Internal Deletion Endpoints (called by backend service) ---

userController.get(
  '/admin/deletions/due',
  async (req: Request, res: Response) => {
    const isAdmin = await handleAdminAuth(req, res)
    if (!isAdmin) {
      return
    }

    try {
      const requests = await DeletionUseCases.getDueForAnonymisation()
      res.json(requests)
    } catch (error) {
      logger.error(error)
      res.status(500).json({ error: 'Failed to get due deletion requests' })
    }
  },
)

userController.post(
  '/admin/deletions/:id/process',
  async (req: Request, res: Response) => {
    const isAdmin = await handleAdminAuth(req, res)
    if (!isAdmin) {
      return
    }

    try {
      const result = await DeletionUseCases.markAsProcessing(req.params.id)
      if (!result) {
        res.status(404).json({ error: 'Deletion request not found or not pending' })
        return
      }
      res.json(result)
    } catch (error) {
      logger.error(error)
      res.status(500).json({ error: 'Failed to mark as processing' })
    }
  },
)

userController.post(
  '/admin/deletions/:id/anonymise',
  async (req: Request, res: Response) => {
    const isAdmin = await handleAdminAuth(req, res)
    if (!isAdmin) {
      return
    }

    try {
      await DeletionUseCases.anonymiseUser(req.params.id)
      res.sendStatus(200)
    } catch (error) {
      logger.error(error)
      res.status(500).json({ error: 'Failed to anonymise user' })
    }
  },
)

userController.post(
  '/admin/deletions/:id/complete',
  async (req: Request, res: Response) => {
    const isAdmin = await handleAdminAuth(req, res)
    if (!isAdmin) {
      return
    }

    try {
      const result = await DeletionUseCases.markAsCompleted(req.params.id)
      if (!result) {
        res.status(404).json({ error: 'Deletion request not found' })
        return
      }
      res.json(result)
    } catch (error) {
      logger.error(error)
      res.status(500).json({ error: 'Failed to mark as completed' })
    }
  },
)

userController.post(
  '/admin/deletions/:id/fail',
  async (req: Request, res: Response) => {
    const isAdmin = await handleAdminAuth(req, res)
    if (!isAdmin) {
      return
    }

    try {
      const { adminNotes } = req.body ?? {}
      const result = await DeletionUseCases.markAsFailed(
        req.params.id,
        typeof adminNotes === 'string' ? adminNotes : undefined,
      )
      if (!result) {
        res.status(404).json({ error: 'Deletion request not found' })
        return
      }
      res.json(result)
    } catch (error) {
      logger.error(error)
      res.status(500).json({ error: 'Failed to mark as failed' })
    }
  },
)

userController.get('/:publicId', async (req: Request, res: Response) => {
  const { publicId } = req.params

  const isAdmin = await handleAdminAuth(req, res)
  if (!isAdmin) {
    return
  }

  const user = await UsersUseCases.getUserWithOrganization(publicId)

  res.json(user)
})

export { userController }
