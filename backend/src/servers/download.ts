;(async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  await import('../apis/download.js')
  const { EventRouter } = await import('../services/eventRouter/index.js')
  EventRouter.listenDownloadEvents()
})()
