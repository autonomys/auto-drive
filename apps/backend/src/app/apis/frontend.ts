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
import { featuresController } from '../controllers/features.js'
import { featureFlagMiddleware } from '../../core/featureFlags/express.js'

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
  }

  app.use('/objects', objectController)
  // TODO: Remove this after migration
  app.use('/subscriptions', accountController)
  app.use('/accounts', accountController)
  app.use('/uploads', uploadController)
  app.use('/intents', featureFlagMiddleware('buyCredits'), intentsController)
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
