import cors from 'cors'
import express, { Request, Response } from 'express'

import 'dotenv/config.js'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('api:worker')

const createServer = async () => {
  logger.debug('Initializing worker API server')
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

  app.get('/health', (_req: Request, res: Response) => {
    logger.trace('Health check request received')
    res.sendStatus(204)
  })

  app.listen(config.express.port, () => {
    logger.info('Server running at http://localhost:%d', config.express.port)
  })
}

createServer().catch((error) => {
  logger.error('Failed to start server:', error)
  process.exit(1)
})
