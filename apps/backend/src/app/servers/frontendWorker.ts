;(async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  await import('../../app/apis/worker.js')
  const { EventRouter } = await import(
    '../../infrastructure/eventRouter/index.js'
  )
  const { config } = await import('../../config.js')
  const { objectMappingArchiver } = await import(
    '../../infrastructure/services/dsn/objectMappingListener/index.js'
  )
  const { createLogger } = await import(
    '../../infrastructure/drivers/logger.js'
  )
  const logger = createLogger('servers:frontendWorker')

  if (config.featureFlags.flags.taskManager.active) {
    EventRouter.listenFrontendEvents()
  }
  if (config.featureFlags.flags.objectMappingArchiver.active) {
    objectMappingArchiver.start()
  }
  if (
    !config.featureFlags.flags.taskManager.active &&
    !config.featureFlags.flags.objectMappingArchiver.active
  ) {
    logger.info('No services active, exiting')
    process.exit(1)
  }
})()
