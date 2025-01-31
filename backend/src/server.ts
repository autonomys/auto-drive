const loadServer = async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }
  await import('./worker.js')
  await import('./api.js')
}

loadServer()
