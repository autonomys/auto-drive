const loadServer = async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js')
  }
  await import('./worker.js')
  await import('./api.js')
}

loadServer()
