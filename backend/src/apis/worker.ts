import cors from 'cors'
import express from 'express'

import 'dotenv/config.js'
import { config } from '../config.js'
import { logger } from '../drivers/logger.js'

const createServer = async () => {
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
  if (config.express.corsAllowedOrigins) {
    app.use(
      cors({
        origin: config.express.corsAllowedOrigins,
      }),
    )
  }

  app.get('/health', (_req, res) => {
    res.sendStatus(204)
  })

  app.listen(config.express.port, () => {
    logger.info(`Server running at http://localhost:${config.express.port}`)
  })
}

createServer().catch(console.error)
