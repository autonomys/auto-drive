;(async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  await import('../../app/apis/frontend.js')
  const { EventRouter } = await import(
    '../../infrastructure/eventRouter/index.js'
  )
  const { config } = await import('../../config.js')
  const { paymentManager } = await import(
    '../../infrastructure/services/paymentManager/index.js'
  )
  EventRouter.listenFrontendEvents()
  // This all-in-one server also consumes publish-manager so a single-process
  // deployment (e.g. local `start:fe`) still publishes nodes. In the split
  // production topology this queue is served by the dedicated publish worker
  // (start:publish:worker) instead. Publishing runs in a single process either
  // way, keeping signing-account nonces collision-free.
  EventRouter.listenPublishEvents()
  if (
    config.featureFlags.flags.buyCredits.active ||
    config.featureFlags.flags.buyCredits.staffOnly
  ) {
    paymentManager.start()

    // The all-in-one server is both the API and the worker, so it owns the
    // treasury poller too. A no-op without a USDC configuration.
    const { usdcTreasuryBalanceJob } = await import(
      '../../infrastructure/services/usdcTreasuryBalanceJob.js'
    )
    usdcTreasuryBalanceJob.start()
  }
})()
