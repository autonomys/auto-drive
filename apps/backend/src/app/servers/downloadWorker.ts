;(async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  await import('../../app/apis/worker.js')
  const { EventRouter } = await import('../../infrastructure/eventRouter/index.js')
  EventRouter.listenDownloadEvents()

  // Consume the error queues here as well as in the frontend worker. This worker
  // is ungated by feature flags, so it is the one process guaranteed to be
  // draining them. RabbitMQ hands each message to a single consumer, so the
  // second reader shares the work rather than double-alerting.
  EventRouter.listenTaskErrors()

  // Batched alerts are already acked off the queue, so a restart inside the
  // batching window loses them. With a 30-minute window that is worth handling:
  // deploys are exactly when tasks fail. `flushTaskErrorAlerts` is internally
  // bounded (the webhook post has its own 10s timeout and never rejects), so it
  // cannot stall the container's stop grace period.
  const { Rabbit } = await import('../../infrastructure/drivers/rabbit.js')
  const { createLogger } = await import(
    '../../infrastructure/drivers/logger.js'
  )
  const logger = createLogger('servers:downloadWorker')

  const shutdown = async () => {
    logger.info('Shutting down download worker...')
    const { flushTaskErrorAlerts } = await import(
      '../../infrastructure/eventRouter/taskErrorNotifier.js'
    )
    await flushTaskErrorAlerts()
    await Rabbit.close()
    logger.info('Download worker shut down successfully')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
})()
