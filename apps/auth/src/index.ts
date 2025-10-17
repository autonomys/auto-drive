import 'dotenv/config'
import cors from 'cors'
import { userController } from './controllers/user.js'
import { config } from './config.js'
import { createLogger } from './drivers/logger.js'
import express, { Request, Response, NextFunction } from 'express'
import { organizationController } from './controllers/organization.js'

const logger = createLogger('auth:server')

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now()
  logger.trace('START %s %s', req.method, req.url)
  res.on('finish', () => {
    const ms = Date.now() - start
    logger.trace('END   %s %s %d %dms', req.method, req.url, res.statusCode, ms)
  })
  next()
})

if (config.corsAllowedOrigins) {
  app.use(
    cors({
      origin: config.corsAllowedOrigins,
    }),
  )
}

app.use('/users', userController)
app.use('/organizations', organizationController)

app.listen(config.port, () => {
  logger.info('Server is running on port %d', config.port)
})

export { app }
