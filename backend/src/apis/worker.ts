import cors from 'cors'
import express from 'express'

import 'dotenv/config.js'
import { commonConfig } from '../config.js'
import { logger } from '../drivers/logger.js'

const createServer = async () => {
  const app = express()

  app.use(
    express.json({
      limit: commonConfig.express.requestSizeLimit,
    }),
  )
  app.use(
    express.urlencoded({
      limit: commonConfig.express.requestSizeLimit,
      extended: true,
    }),
  )
  if (commonConfig.express.corsAllowedOrigins) {
    app.use(
      cors({
        origin: commonConfig.express.corsAllowedOrigins,
      }),
    )
  }

  app.get('/health', (_req, res) => {
    res.sendStatus(204)
  })

  app.listen(commonConfig.express.port, () => {
    logger.info(
      `Server running at http://localhost:${commonConfig.express.port}`,
    )
  })
}

createServer().catch(console.error)
