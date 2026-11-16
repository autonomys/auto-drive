import cors from 'cors'
import express, { Request, Response } from 'express'

import 'dotenv/config.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { downloadController } from '../controllers/download.js'
import { s3Controller } from '../controllers/s3/http.js'
import { featuresController } from '../controllers/features.js'

const logger = createLogger('api:download')

const createServer = async () => {
  logger.debug('Initializing download API server')
  const app = express()

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

  // The S3 controller handles its own raw body parsing (binary object
  // payloads). No other route here reads a request body, so this API mounts no
  // JSON or URL-encoded parser.
  app.use('/s3', s3Controller)

  app.use('/downloads', downloadController)
  app.use('/features', featuresController)

  logger.debug('Download controller mounted at /downloads')

  app.get('/health', (_req: Request, res: Response) => {
    logger.trace('Health check request received')
    res.sendStatus(204)
  })

  app.get('/auth/session', async (req: Request, res: Response) => {
    logger.debug('Session authentication request received')
    try {
      const user = await handleAuth(req, res)
      if (!user) {
        logger.info('Authentication failed - no user found')
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

createServer().catch((error) => {
  logger.error('Failed to start server:', error)
  process.exit(1)
})
