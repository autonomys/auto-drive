import { Rabbit } from '../drivers/rabbit.js'
import {
  downloadErrorPublishedQueue,
  processDownloadTask,
} from './processors/download.js'
import {
  frontendErrorPublishedQueue,
  processFrontendTask,
} from './processors/frontend.js'
import {
  processPublishTask,
  publishErrorPublishedQueue,
} from './processors/publish.js'
import { Task } from './tasks.js'

export const EventRouter = {
  listenFrontendEvents: () => {
    Rabbit.subscribe('task-manager', processFrontendTask)
  },
  listenDownloadEvents: () => {
    Rabbit.subscribe('download-manager', processDownloadTask)
  },
  listenPublishEvents: () => {
    Rabbit.subscribe('publish-manager', processPublishTask)
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
  publishFailedTask: (task: Task) => {
    Rabbit.publish(getFailedTaskQueue(task), task)
  },
}

const getTargetQueueByTask = (task: Task) => {
  switch (task.id) {
    case 'async-download-created':
    case 'object-archived':
    case 'populate-cache':
      return 'download-manager'
    // On-chain publishing blocks for the confirmation-depth window per batch;
    // route it to a dedicated queue/worker so those waits never hold up the
    // fast frontend tasks on task-manager.
    case 'publish-nodes':
      return 'publish-manager'
    default:
      return 'task-manager'
  }
}

const getFailedTaskQueue = (task: Task) => {
  switch (getTargetQueueByTask(task)) {
    case 'task-manager':
      return frontendErrorPublishedQueue
    case 'download-manager':
      return downloadErrorPublishedQueue
    case 'publish-manager':
      return publishErrorPublishedQueue
    default:
      throw new Error(`Unknown task: ${task.id}`)
  }
}
