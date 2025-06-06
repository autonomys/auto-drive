import cors from 'cors'
import express from 'express'

import 'dotenv/config.js'
import { handleAuth } from '../services/auth/express.js'
import { commonConfig } from '../config.js'
import { logger } from '../drivers/logger.js'
import { downloadController } from '../http/controllers/download.js'

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

  app.use('/downloads', downloadController)
  app.get('/health', (_req, res) => {
    res.sendStatus(204)
  })

  app.get('/auth/session', async (req, res) => {
    try {
      const user = await handleAuth(req, res)
      if (!user) {
        return
      }

      res.json(user)
    } catch (error) {
      console.error('Error retrieving session:', error)
      res.status(500).json({
        error: 'Failed to retrieve session',
      })
    }
  })

  app.listen(commonConfig.express.port, () => {
    logger.info(
      `Server running at http://localhost:${commonConfig.express.port}`,
    )
  })
}

createServer().catch(console.error)
