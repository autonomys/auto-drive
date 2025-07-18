import cors from 'cors'
import express, { Request, Response } from 'express'

import 'dotenv/config.js'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { downloadController } from '../controllers/download.js'

const logger = createLogger('api:download')

const createServer = async () => {
  logger.debug('Initializing download API server')
  const app = express()

  app.use(
    express.json({
      limit: config.express.requestSizeLimit,
    }),
  )
  logger.trace(
    'JSON body parser middleware configured with limit: %s',
    config.express.requestSizeLimit,
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
    logger.warn('CORS is not configured - no allowed origins specified')
  }

  app.use('/downloads', downloadController)
  logger.debug('Download controller mounted at /downloads')

  app.get('/health', (_req: Request, res: Response) => {
    logger.trace('Health check request received')
    res.sendStatus(204)
  })

  app.get('/services', (_req, res) => {
    logger.debug('Services configuration requested')
    res.json(config.services)
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
