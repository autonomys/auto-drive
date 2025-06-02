const createWorkerService = async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  const { config } = await import('./config.js')
  const { TaskManager } = await import('./services/taskManager/index.js')
  const { objectMappingArchiver } = await import(
    './services/dsn/objectMappingListener/index.js'
  )
  if (config.services.objectMappingArchiver.active) {
    objectMappingArchiver.start()
  }

  if (config.services.taskManager.active) {
    TaskManager.start()
  }
}

createWorkerService()
