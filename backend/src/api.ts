import cors from 'cors'
import express from 'express'

import 'dotenv/config.js'
import { objectController } from './controllers/object.js'
import { userController } from './controllers/user.js'
import { handleAuth } from './services/authManager/express.js'
import { uploadController } from './controllers/upload.js'
import { config } from './config.js'
import { logger } from './drivers/logger.js'

const createServer = async () => {
  const app = express()

  app.use(
    express.json({
      limit: config.requestSizeLimit,
    }),
  )
  app.use(
    express.urlencoded({
      limit: config.requestSizeLimit,
      extended: true,
    }),
  )
  if (config.corsAllowedOrigins) {
    app.use(
      cors({
        origin: config.corsAllowedOrigins,
      }),
    )
  }

  app.use('/objects', objectController)
  app.use('/users', userController)
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

  app.listen(config.port, () => {
    logger.info(`Server running at http://localhost:${config.port}`)
  })
}

createServer().catch(console.error)
