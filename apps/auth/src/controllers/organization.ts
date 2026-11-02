import { Router, Request, Response } from 'express'
import { OrganizationsUseCases } from '../useCases/index.js'
import { createLogger } from '../drivers/logger.js'
import {
  handleAdminAuth,
  handleServiceAuth,
} from '../services/authManager/express.js'
import { OrganizationError } from '../errors/organizations.js'

const logger = createLogger('http:controllers:organization')

export const organizationController = Router()

const handleError = (error: unknown, res: Response, message: string) => {
  if (error instanceof OrganizationError) {
    res.status(error.httpStatus).json({ error: error.message })
    return
  }
  logger.error(error)
  res.status(500).json({ error: message })
}

// Every write below records the Auto Drive admin who made it.
const getActor = (req: Request, res: Response): string | null => {
  const actor = req.body?.actor
  if (typeof actor !== 'string' || !actor) {
    res.status(400).json({ error: 'actor is required' })
    return null
  }
  return actor
}

organizationController.post('/', async (req: Request, res: Response) => {
  if (!handleServiceAuth(req, res)) {
    return
  }

  const { name } = req.body ?? {}
  if (typeof name !== 'string') {
    res.status(400).json({ error: 'name must be a string' })
    return
  }

  try {
    res.status(201).json(await OrganizationsUseCases.createOrganization(name))
  } catch (error) {
    handleError(error, res, 'Failed to create organization')
  }
})

organizationController.post('/batch', async (req: Request, res: Response) => {
  if (!handleServiceAuth(req, res)) {
    return
  }

  const { ids } = req.body ?? {}
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    !ids.every((id) => typeof id === 'string')
  ) {
    res.status(400).json({ error: 'ids must be an array of up to 100 strings' })
    return
  }

  try {
    res.json(await OrganizationsUseCases.getOrganizationSummaries(ids))
  } catch (error) {
    handleError(error, res, 'Failed to get organizations')
  }
})

organizationController.get(
  '/:organizationId',
  async (req: Request, res: Response) => {
    const isAdmin = await handleAdminAuth(req, res)
    if (!isAdmin) {
      return
    }

    const { organizationId } = req.params
    try {
      const organization =
        await OrganizationsUseCases.getOrganization(organizationId)
      res.json(organization)
    } catch (error) {
      handleError(error, res, 'Failed to get organization')
    }
  },
)

organizationController.get(
  '/:organizationId/membership-changes',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }

    try {
      res.json(
        await OrganizationsUseCases.getMembershipChanges(
          req.params.organizationId,
        ),
      )
    } catch (error) {
      handleError(error, res, 'Failed to get membership changes')
    }
  },
)

organizationController.post(
  '/:organizationId/members',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }
    const actor = getActor(req, res)
    if (!actor) {
      return
    }

    const { publicId, role } = req.body
    if (typeof publicId !== 'string') {
      res.status(400).json({ error: 'publicId must be a string' })
      return
    }

    try {
      await OrganizationsUseCases.addMember({
        organizationId: req.params.organizationId,
        publicId,
        role,
        actor,
      })
      res.status(204).end()
    } catch (error) {
      handleError(error, res, 'Failed to add member')
    }
  },
)

organizationController.patch(
  '/:organizationId/members/:publicId',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }
    const actor = getActor(req, res)
    if (!actor) {
      return
    }

    try {
      await OrganizationsUseCases.changeMemberRole({
        organizationId: req.params.organizationId,
        publicId: req.params.publicId,
        role: req.body.role,
        actor,
      })
      res.status(204).end()
    } catch (error) {
      handleError(error, res, 'Failed to change member role')
    }
  },
)

organizationController.delete(
  '/:organizationId/members/:publicId',
  async (req: Request, res: Response) => {
    if (!handleServiceAuth(req, res)) {
      return
    }
    const actor = getActor(req, res)
    if (!actor) {
      return
    }

    try {
      res.json(
        await OrganizationsUseCases.removeMember({
          organizationId: req.params.organizationId,
          publicId: req.params.publicId,
          actor,
        }),
      )
    } catch (error) {
      handleError(error, res, 'Failed to remove member')
    }
  },
)
