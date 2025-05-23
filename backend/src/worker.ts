const createWorkerService = async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./servers/awsSetup.js').then(
      ({ setupFinished }) => setupFinished,
    )
  }

  const { config } = await import('./config.js')
  const { EventRouter: TaskManager } = await import(
    './services/eventRouter/index.js'
  )
  const { objectMappingArchiver } = await import(
    './services/dsn/objectMappingListener/index.js'
  )
  if (config.services.objectMappingArchiver.active) {
    objectMappingArchiver.start()
  }

  if (config.services.taskManager.active) {
    TaskManager.listenFrontendEvents()
  }
}

createWorkerService()
