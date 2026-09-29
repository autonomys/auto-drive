import { Router } from 'express'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { getFeatureFlags } from '../../core/featureFlags/express.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'

const logger = createLogger('http:controllers:features')

export const featuresController = Router()

// asyncSafeHandler, because this handler can now await a database read (the USDC
// availability overlay). Express 4 does not catch a rejected promise from a route
// handler, so without this an unhandled rejection would take the process down —
// and this controller is mounted on the download API as well as the frontend one.
// The overlay itself also fails closed rather than throwing; this is the second
// layer, for anything else that ever awaits here.
featuresController.get(
  '/',
  asyncSafeHandler(async (req, res) => {
    logger.debug('Services configuration requested')

    const featureFlags = await getFeatureFlags(req, res)
    if (!featureFlags) {
      return
    }

    res.json(featureFlags)
  }),
)
