import { Rabbit } from '../drivers/rabbit.js'
import { processDownloadTask } from './processors/download.js'
import { processFrontendTask } from './processors/frontend.js'
import { Task } from './tasks.js'

export const EventRouter = {
  listenFrontendEvents: () => {
    Rabbit.subscribe('task-manager', processFrontendTask)
  },
  listenDownloadEvents: () => {
    Rabbit.subscribe('download-manager', processDownloadTask)
  },
  publish: (tasks: Task[] | Task) => {
    if (Array.isArray(tasks)) {
      tasks.forEach((task) => {
        Rabbit.publish(getTargetQueueByTask(task), task)
      })
    } else {
      Rabbit.publish(getTargetQueueByTask(tasks), tasks)
    }
  },
}

const getTargetQueueByTask = (task: Task) => {
  switch (task.id) {
    case 'async-download-created':
    case 'object-archived':
      return 'download-manager'
    default:
      return 'task-manager'
  }
}
