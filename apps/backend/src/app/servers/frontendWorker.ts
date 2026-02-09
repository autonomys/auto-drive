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

  const { paymentManager } = await import(
    '../../infrastructure/services/paymentManager/index.js'
  )

  const { Rabbit } = await import(
    '../../infrastructure/drivers/rabbit.js'
  )

  let somethingActive = false
  if (config.featureFlags.flags.taskManager.active) {
    EventRouter.listenFrontendEvents()
    somethingActive = true
  }
  if (config.featureFlags.flags.objectMappingArchiver.active) {
    objectMappingArchiver.start()
    somethingActive = true
  }
  if (
    config.featureFlags.flags.buyCredits.active ||
    config.featureFlags.flags.buyCredits.staffOnly
  ) {
    paymentManager.start()
    somethingActive = true
  }
  if (!somethingActive) {
    logger.info('No services active, exiting')
    process.exit(1)
  }

  const shutdown = async () => {
    logger.info('Shutting down frontend worker...')
    objectMappingArchiver.stop()
    paymentManager.stop()
    await Rabbit.close()
    logger.info('Frontend worker shut down successfully')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
})()
