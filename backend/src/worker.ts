import { config } from './config.js'
import { objectMappingArchiver } from './services/dsn/objectMappingListener/index.js'
import { TaskManager } from './services/taskManager/index.js'

if (config.services.objectMappingArchiver.active) {
  objectMappingArchiver.start()
}

if (config.services.taskManager.active) {
  TaskManager.start()
}
