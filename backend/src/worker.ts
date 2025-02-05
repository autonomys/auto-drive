import { objectMappingArchiver } from './services/dsn/objectMappingListener/index.js'
import { TaskManager } from './services/taskManager/index.js'

objectMappingArchiver.start()
TaskManager.start()
