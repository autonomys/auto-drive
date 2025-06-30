import cors from 'cors'
import express from 'express'

import 'dotenv/config.js'
import { handleAuth } from '../services/auth/express.js'
import { config } from '../config.js'
import { createLogger } from '../drivers/logger.js'
import { downloadController } from '../http/controllers/download.js'

const logger = createLogger('api:download')

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

  app.use('/downloads', downloadController)
  app.get('/health', (_req, res) => {
    res.sendStatus(204)
  })

  app.get('/services', (_req, res) => {
    res.json(config.services)
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

  app.listen(config.express.port, () => {
    logger.info(`Server running at http://localhost:${config.express.port}`)
  })
}

createServer().catch(console.error)
