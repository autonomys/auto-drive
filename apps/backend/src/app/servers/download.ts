;(async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  await import('../../app/apis/download.js')
  const { EventRouter } = await import(
    '../../infrastructure/eventRouter/index.js'
  )
  EventRouter.listenDownloadEvents()
})()
