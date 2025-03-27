import { logger } from '../../drivers/logger.js'
import { Rabbit } from '../../drivers/rabbit.js'
import { NodesUseCases } from '../../useCases/objects/nodes.js'
import { UploadsUseCases } from '../../useCases/uploads/uploads.js'
import { exhaustiveCheck } from '../../utils/misc.js'
import { OnchainPublisher } from '../upload/onchainPublisher/index.js'
import { Task, TaskSchema } from './tasks.js'

export const TaskManager = {
  start: () => {
    Rabbit.subscribe(async (obj: unknown) => {
      const task = TaskSchema.safeParse(obj)
      if (task.success) {
        logger.debug('Received task', task.data)
        await processTask(task.data)
      } else {
        console.error('Invalid task', task.error)
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

const processTask = ({ id, params }: Task) => {
  if (id === 'migrate-upload-nodes') {
    return UploadsUseCases.processMigration(params.uploadId)
  } else if (id === 'archive-objects') {
    return NodesUseCases.processNodeArchived(params.objects)
  } else if (id === 'publish-nodes') {
    return OnchainPublisher.publishNodes(params.nodes)
  } else if (id === 'tag-upload') {
    return UploadsUseCases.tagUpload(params.cid)
  } else {
    return exhaustiveCheck(id)
  }
}
