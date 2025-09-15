;(async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  await import('../../app/apis/frontend.js')
  const { EventRouter } = await import('../../infrastructure/eventRouter/index.js')
  const { paymentManager } = await import('../../infrastructure/services/paymentManager/index.js')
  EventRouter.listenFrontendEvents()
  paymentManager.start()
})()
