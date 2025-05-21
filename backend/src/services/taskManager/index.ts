import { logger } from '../../drivers/logger.js'
import { Rabbit } from '../../drivers/rabbit.js'
import { AsyncDownloadsUseCases } from '../../useCases/asyncDownloads/index.js'
import { NodesUseCases } from '../../useCases/objects/nodes.js'
import { UploadsUseCases } from '../../useCases/uploads/uploads.js'
import { exhaustiveCheck } from '../../utils/misc.js'
import { OnchainPublisher } from '../upload/onchainPublisher/index.js'
import { Task, TaskSchema } from './tasks.js'

export const TaskManager = {
  start: () => {
    Rabbit.subscribe(async (obj: unknown) => {
      const task = TaskSchema.safeParse(obj)
      if (!task.success) {
        logger.error('Invalid task', task.error)
        return
      }

      try {
        await processTask(task.data)
      } catch (error) {
        if (task.data.retriesLeft > 0) {
          const newTask = {
            ...task.data,
            retriesLeft: task.data.retriesLeft - 1,
          }
          Rabbit.publish(newTask)
        } else {
          logger.error('Task failed', error)
        }
      }
    })
  },
  publish: (tasks: Task[] | Task) => {
    if (Array.isArray(tasks)) {
      tasks.forEach((task) => {
        Rabbit.publish(task)
      })
    } else {
      Rabbit.publish(tasks)
    }
  },
}

const processTask = ({ id, params, retriesLeft }: Task) => {
  if (id === 'migrate-upload-nodes') {
    return UploadsUseCases.processMigration(params.uploadId)
  } else if (id === 'archive-objects') {
    return NodesUseCases.processNodeArchived(params.objects)
  } else if (id === 'publish-nodes') {
    return OnchainPublisher.publishNodes(params.nodes, retriesLeft)
  } else if (id === 'tag-upload') {
    return UploadsUseCases.tagUpload(params.cid)
  } else if (id === 'async-download-created') {
    return AsyncDownloadsUseCases.asyncDownload(params.downloadId)
  } else {
    return exhaustiveCheck(id)
  }
}
