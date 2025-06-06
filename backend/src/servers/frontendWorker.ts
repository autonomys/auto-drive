import { config } from '../config.js'
import { objectMappingArchiver } from '../services/dsn/objectMappingListener/index.js'
;(async () => {
  if (process.env.NODE_ENV === 'production') {
    await import('./awsSetup.js').then(({ setupFinished }) => setupFinished)
  }

  await import('../apis/worker.js')
  const { EventRouter } = await import('../services/eventRouter/index.js')
  if (config.services.taskManager.active) {
    EventRouter.listenFrontendEvents()
  }
  if (config.services.objectMappingArchiver.active) {
    objectMappingArchiver.start()
  }
})()
