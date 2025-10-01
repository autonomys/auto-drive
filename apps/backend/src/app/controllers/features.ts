import { Router } from 'express'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { getFeatureFlags } from '../../core/featureFlags/express.js'

const logger = createLogger('http:controllers:features')

export const featuresController = Router()

featuresController.get('/', async (req, res) => {
  logger.debug('Services configuration requested')

  const featureFlags = await getFeatureFlags(req, res)
  if (!featureFlags) {
    return
  }

  res.json(featureFlags)
})
