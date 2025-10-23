import { Router, Request, Response } from 'express'
import { OrganizationsUseCases } from '../useCases/index.js'
import { createLogger } from '../drivers/logger.js'
import { handleAdminAuth } from '../services/authManager/express.js'

const logger = createLogger('http:controllers:organization')

export const organizationController = Router()

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
      logger.error(error)
      res.status(500).json({
        error: 'Failed to get organization',
      })
    }
  },
)
