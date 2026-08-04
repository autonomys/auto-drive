;(async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  await import('../../app/apis/worker.js')
  const { EventRouter } = await import(
    '../../infrastructure/eventRouter/index.js'
  )
  EventRouter.listenDownloadEvents()

  // Consume the error queues here as well as in the frontend worker. This worker
  // is ungated by feature flags, so it is the one process guaranteed to be
  // draining them. RabbitMQ hands each message to a single consumer, so the
  // second reader shares the work rather than double-alerting.
  EventRouter.listenTaskErrors()

  // Batched alerts are already acked off the queue, so a restart inside the
  // batching window loses them. With a 30-minute window that is worth handling:
  // deploys are exactly when tasks fail.
  //
  // Every step is bounded, and the sequence as a whole is too. Until this handler
  // existed SIGTERM terminated the process outright, so anything unbounded here
  // is a straight regression: the drain makes up to five sends of 10s each, and
  // cancelling a consumer and closing a channel are broker RPCs that wait for a
  // reply the broker may never send. Docker allows 10s before SIGKILL.
  const { Rabbit } = await import('../../infrastructure/drivers/rabbit.js')
  const { createLogger } = await import(
    '../../infrastructure/drivers/logger.js'
  )
  const { startShutdownWatchdog, shutdownStep } = await import(
    '../../shared/utils/shutdown.js'
  )
  const logger = createLogger('servers:downloadWorker')

  const shutdown = async () => {
    logger.info('Shutting down download worker...')
    const stopWatchdog = startShutdownWatchdog(logger)

    // Stop consuming before flushing: otherwise failures keep arriving while the
    // final send is awaited and land in a batch created after the flush finished.
    await shutdownStep(logger, 'stop error consumers', 2_000, () =>
      EventRouter.stopTaskErrors(),
    )
    const { flushTaskErrorAlerts } = await import(
      '../../infrastructure/eventRouter/taskErrorNotifier.js'
    )
    // Ordered after the cancel but not dependent on it: this talks to Slack, so
    // a broker that has stopped answering must not cost us the alerts.
    await shutdownStep(logger, 'flush task error alerts', 4_000, () =>
      flushTaskErrorAlerts(),
    )
    await shutdownStep(logger, 'close rabbit channel', 2_000, () =>
      Rabbit.close(),
    )

    stopWatchdog()
    logger.info('Download worker shut down successfully')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
})()
