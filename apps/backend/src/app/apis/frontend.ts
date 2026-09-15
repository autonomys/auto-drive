import cors from 'cors'
import express, { Request, Response } from 'express'

import 'dotenv/config.js'
import { objectController } from '../controllers/object.js'
import { accountController } from '../controllers/accounts.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { uploadController } from '../controllers/upload.js'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { docsController } from '../controllers/docs.js'
import { intentsController } from '../controllers/intents.js'
import { creditsController } from '../controllers/credits.js'
import { bannersController } from '../controllers/banners.js'
import { paymentsController } from '../controllers/payments.js'
import { touController } from '../controllers/tou.js'
import { deletionController } from '../controllers/deletion.js'
import { featuresController } from '../controllers/features.js'
import { featureFlagMiddleware } from '../../core/featureFlags/express.js'
import { IntentsUseCases } from '../../core/users/intents.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleInternalError } from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'
import { StoragePrice } from '@auto-drive/models'

const logger = createLogger('api:frontend')

const createServer = async () => {
  logger.debug('Initializing frontend API server')
  const app = express()

  app.use(
    express.json({
      limit: config.express.requestSizeLimit,
    }),
  )
  app.use(
    express.urlencoded({
      limit: config.express.requestSizeLimit,
      extended: true,
    }),
  )
  logger.trace(
    'URL-encoded parser middleware configured with limit: %s',
    config.express.requestSizeLimit,
  )
  if (config.express.corsAllowedOrigins) {
    logger.debug(
      'Configuring CORS with allowed origins: %j',
      config.express.corsAllowedOrigins,
    )
    app.use(
      cors({
        origin: config.express.corsAllowedOrigins,
      }),
    )
  } else {
    logger.warn('CORS is not configured - no allowed origins specified, blocking cross-origin requests')
  }

  app.use('/objects', objectController)
  // TODO: Remove this after migration
  app.use('/subscriptions', accountController)
  app.use('/accounts', accountController)
  app.use('/uploads', uploadController)
  app.get(
    '/intents/price',
    asyncSafeHandler(async (_req, res) => {
      // getStoragePrice, not getPrice: the response carries the USD conversion
      // alongside the AI3 rate. An oracle failure is not an error here — it
      // comes back as a null `usd` on an otherwise complete price.
      const result = await handleInternalError(
        new Promise<StoragePrice>((resolve) =>
          resolve(IntentsUseCases.getStoragePrice()),
        ),
        'Failed to get price',
      )
      if (result.isErr()) {
        handleError(result.error, res)
        return
      }
      res.status(200).json(result.value)
    }),
  )
  app.get('/intents/contract', (_req, res) => {
    res.status(200).json({
      chainId: config.paymentManager.chainId,
      contractAddress: config.paymentManager.contractAddress,
      payIntentAbi: [
        {
          inputs: [{ name: 'intentId', type: 'bytes32' }],
          name: 'payIntent',
          outputs: [],
          stateMutability: 'payable',
          type: 'function',
        },
      ],
    })
  })
  app.use('/intents', featureFlagMiddleware('buyCredits'), intentsController)
  app.use('/credits', featureFlagMiddleware('buyCredits'), creditsController)
  app.use('/banners', bannersController)
  // Deliberately NOT behind featureFlagMiddleware('buyCredits'): these are the
  // admin controls for the USDC path, and hiding them behind the flag that gates
  // buying would make the kill switch unreachable exactly when purchases are
  // switched off. Authorisation is per-route and admin-only.
  app.use('/payments', paymentsController)
  app.use('/tou', touController)
  app.use('/deletion', deletionController)
  app.use('/features', featuresController)
  app.use('/docs', docsController)

  app.get('/health', (_req, res) => {
    logger.trace('Health check request received')
    res.sendStatus(204)
  })

  app.get('/auth/session', async (req: Request, res: Response) => {
    try {
      const user = await handleAuth(req, res)
      if (!user) {
        logger.warn('Authentication failed - no user found')
        return
      }

      logger.trace('User authenticated successfully: %j', user)
      res.json(user)
    } catch (error) {
      logger.error('Error retrieving session:', error)
      res.status(500).json({
        error: 'Failed to retrieve session',
      })
    }
  })

  app.listen(config.express.port, () => {
    logger.info('Server running at http://localhost:%d', config.express.port)
  })
}

createServer().catch(console.error)
