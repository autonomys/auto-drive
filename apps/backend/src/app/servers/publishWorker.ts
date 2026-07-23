;(async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  await import('../../app/apis/worker.js')
  const { EventRouter } = await import(
    '../../infrastructure/eventRouter/index.js'
  )
  const { Rabbit } = await import('../../infrastructure/drivers/rabbit.js')
  const { createLogger } = await import(
    '../../infrastructure/drivers/logger.js'
  )
  const logger = createLogger('servers:publishWorker')

  // Dedicated consumer for the publish-manager queue. On-chain publishing
  // blocks for the confirmation-depth window per batch; isolating it in its own
  // process keeps those waits off the frontend worker's task-manager slots.
  //
  // IMPORTANT: on-chain publishing must run in exactly one process. Signing
  // accounts' nonces are tracked in-memory per process (see accounts.ts), so a
  // second concurrent publisher would hand out colliding nonces. Run this
  // worker as a single replica and do not enable publish-nodes handling
  // elsewhere.
  //
  // Deploy note: the pre-isolation frontend worker signed publish-nodes inline,
  // so during a rolling upgrade an old start:fe:worker can still be signing when
  // this worker starts. The compose `depends_on: backend-worker` sequences the
  // standard single-host deploy so the old worker is stopped first; other deploy
  // models must ensure the old frontend worker is gone before this worker signs.
  EventRouter.listenPublishEvents()
  logger.info('Publish worker started, consuming publish-manager queue')

  const shutdown = async () => {
    logger.info('Shutting down publish worker...')
    await Rabbit.close()
    logger.info('Publish worker shut down successfully')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
})()
