import { logger } from '../../drivers/logger'
import { Rabbit } from '../../drivers/rabbit'
import { NodesUseCases } from '../../useCases'
import { UploadsUseCases } from '../../useCases/uploads/uploads'
import { exhaustiveCheck } from '../../utils/misc'
import { OnchainPublisher } from '../upload/onchainPublisher'
import { Task, TaskSchema } from './tasks'

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
  } else {
    return exhaustiveCheck(id)
  }
}
