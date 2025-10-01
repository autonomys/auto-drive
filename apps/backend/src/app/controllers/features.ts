import { Router } from 'express'
import { FeatureFlagsUseCases } from '../../core/featureFlags/index.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('http:controllers:features')

export const featuresController = Router()

featuresController.get('/', async (_req, res) => {
  logger.debug('Services configuration requested')

  // If is authenticated, get the user from the request
  if (_req.headers.authorization) {
    const user = await handleAuth(_req, res)
    if (!user) {
      return
    }

    res.json(FeatureFlagsUseCases.get(user))
    return
  }

  res.json(FeatureFlagsUseCases.get(null))
})
