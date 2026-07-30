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
})()
