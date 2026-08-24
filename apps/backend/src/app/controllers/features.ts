import { Router } from 'express'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { getFeatureFlags } from '../../core/featureFlags/express.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'

const logger = createLogger('http:controllers:features')

export const featuresController = Router()

// asyncSafeHandler, like every other controller: Express 4 does not catch an
// async rejection, so without it a throw anywhere in here would leave the
// request unanswered — the opposite of this endpoint's "always answers"
// contract, which is now the only thing standing between a stale token and a
// frontend with no flags. It also restores the requestTrace metric.
featuresController.get(
  '/',
  asyncSafeHandler(async (req, res) => {
    logger.debug('Services configuration requested')

    // Always answers: an unresolvable credential yields the unauthenticated flags.
    res.json(await getFeatureFlags(req))
  }),
)
