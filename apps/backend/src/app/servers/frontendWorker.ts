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

  // Ungated by feature flags: a task that exhausted its retries needs to be
  // reported regardless of which subsystems this host runs.
  EventRouter.listenTaskErrors()

  let somethingActive = false
  if (config.featureFlags.flags.taskManager.active) {
    EventRouter.listenFrontendEvents()

    // Re-drive uploads stranded in `migrating` when their one-shot
    // migrate-upload-nodes task was lost or exhausted its retries. This needs
    // only the task-manager consumer (which processes both recover-migrations
    // and the migrate tasks it re-enqueues), so unlike the archival/publishing
    // recovery jobs below it is not gated on the object mapping archiver.
    const { migrationRecoveryJob } = await import(
      '../../infrastructure/services/migrationRecoveryJob.js'
    )
    migrationRecoveryJob.start()

    somethingActive = true
  }
  if (config.featureFlags.flags.objectMappingArchiver.active) {
    objectMappingArchiver.start()

    // Start periodic jobs that require both the task manager queue consumer
    // and the object mapping archiver to be active.
    if (config.featureFlags.flags.taskManager.active) {
      const { reconciliationJob } = await import(
        '../../infrastructure/services/reconciliationJob.js'
      )
      reconciliationJob.start()

      const { publishingRecoveryJob } = await import(
        '../../infrastructure/services/publishingRecoveryJob.js'
      )
      publishingRecoveryJob.start()
    }

    somethingActive = true
  }
  if (
    config.featureFlags.flags.buyCredits.active ||
    config.featureFlags.flags.buyCredits.staffOnly
  ) {
    paymentManager.start()

    const { creditExpiryJob } = await import(
      '../../infrastructure/services/creditExpiryJob.js'
    )
    creditExpiryJob.start()

    somethingActive = true
  }
  if (!somethingActive) {
    logger.info('No services active, exiting')
    process.exit(1)
  }

  // Deletion anonymisation job runs unconditionally
  const { deletionAnonymisationJob } = await import(
    '../../infrastructure/services/deletionAnonymisationJob.js'
  )
  deletionAnonymisationJob.start()

  const shutdown = async () => {
    logger.info('Shutting down frontend worker...')
    objectMappingArchiver.stop()
    // Stop periodic recovery jobs (safe even if never started — stop() is a no-op)
    if (
      config.featureFlags.flags.objectMappingArchiver.active &&
      config.featureFlags.flags.taskManager.active
    ) {
      const { reconciliationJob } = await import(
        '../../infrastructure/services/reconciliationJob.js'
      )
      reconciliationJob.stop()

      const { publishingRecoveryJob } = await import(
        '../../infrastructure/services/publishingRecoveryJob.js'
      )
      publishingRecoveryJob.stop()
    }
    if (config.featureFlags.flags.taskManager.active) {
      const { migrationRecoveryJob } = await import(
        '../../infrastructure/services/migrationRecoveryJob.js'
      )
      migrationRecoveryJob.stop()
    }
    paymentManager.stop()
    const { creditExpiryJob } = await import(
      '../../infrastructure/services/creditExpiryJob.js'
    )
    creditExpiryJob.stop()
    const { deletionAnonymisationJob } = await import(
      '../../infrastructure/services/deletionAnonymisationJob.js'
    )
    deletionAnonymisationJob.stop()
    // Send anything still inside the batching window before the channel closes,
    // so a deploy doesn't swallow the alerts it may itself have caused. Stop
    // consuming first, or failures keep arriving while the final send is awaited
    // and land in a batch created after the flush decided it was finished.
    await EventRouter.stopTaskErrors()
    const { flushTaskErrorAlerts } = await import(
      '../../infrastructure/eventRouter/taskErrorNotifier.js'
    )
    await flushTaskErrorAlerts()
    await Rabbit.close()
    logger.info('Frontend worker shut down successfully')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
})()
