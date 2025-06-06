import { logger } from '../drivers/logger.js'
;(async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  await import('../apis/worker.js')
  const { EventRouter } = await import('../services/eventRouter/index.js')
  const { config } = await import('../config.js')
  const { objectMappingArchiver } = await import(
    '../services/dsn/objectMappingListener/index.js'
  )

  if (config.services.taskManager.active) {
    EventRouter.listenFrontendEvents()
  }
  if (config.services.objectMappingArchiver.active) {
    objectMappingArchiver.start()
  }
  if (
    !config.services.taskManager.active &&
    !config.services.objectMappingArchiver.active
  ) {
    logger.info('No services active, exiting')
    process.exit(1)
  }
})()
