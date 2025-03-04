import cors from 'cors'
import express from 'express'

import 'dotenv/config.js'
import { subscriptionController } from './http/controllers/subscriptions.js'
import { handleAuth } from './services/auth/express.js'
import { config } from './config.js'
import { logger } from './drivers/logger.js'
import { requestTrace } from './http/middlewares/requestTrace.js'
import { RegisterRoutes } from './routes/routes.js'

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
  if (config.monitoring.active) {
    app.use(requestTrace)
  }

  app.use('/subscriptions', subscriptionController)

  app.get('/health', (_req, res) => {
    res.sendStatus(204)
  })

  app.get('/auth/session', async (req, res) => {
    try {
      const user = await handleAuth(req)
      if (!user) {
        res.status(401).json({
          error: 'Unauthorized',
        })
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

  RegisterRoutes(app)

  app.listen(config.express.port, () => {
    logger.info(`Server running at http://localhost:${config.express.port}`)
  })
}

createServer().catch(console.error)
