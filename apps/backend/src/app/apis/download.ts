import 'dotenv/config.js'
import { createDownloadApp } from './downloadApp.js'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('api:download')

const createServer = async () => {
  logger.debug('Initializing download API server')
  const app = createDownloadApp()

  app.listen(config.express.port, () => {
    logger.info('Server running at http://localhost:%d', config.express.port)
  })
}

createServer().catch((error) => {
  logger.error('Failed to start server:', error)
  process.exit(1)
})
