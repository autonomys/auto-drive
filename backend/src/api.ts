import cors from 'cors'
import express from 'express'

import 'dotenv/config.js'
import { objectController } from './http/controllers/object.js'
import { subscriptionController } from './http/controllers/subscriptions.js'
import { handleAuth } from './services/auth/express.js'
import { uploadController } from './http/controllers/upload.js'
import { config } from './config.js'
import { logger } from './drivers/logger.js'
import { requestTrace } from './http/middlewares/requestTrace.js'

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

  app.use('/objects', objectController)
  app.use('/subscriptions', subscriptionController)
  app.use('/uploads', uploadController)

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

  app.listen(config.express.port, () => {
    logger.info(`Server running at http://localhost:${config.express.port}`)
  })
}

createServer().catch(console.error)
