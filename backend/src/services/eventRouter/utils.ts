import { createLogger } from '../../drivers/logger.js'
import { Rabbit } from '../../drivers/rabbit.js'
import { EventRouter } from './index.js'
import { Task, TaskSchema } from './tasks.js'

const logger = createLogger('eventRouter:utils')

type Handler = (task: Task) => Promise<unknown>

export const createHandlerWithRetries =
  (
    handler: Handler,
    {
      errorPublishQueue = 'errors',
      errorRetries = 3,
    }: { errorPublishQueue?: string | null; errorRetries?: number } = {},
  ) =>
  async (obj: unknown) => {
    const task = TaskSchema.safeParse(obj)
    if (!task.success) {
      logger.error('Invalid task', task.error)
      return
    }

    try {
      await handler(task.data)
    } catch (error) {
      if (task.data.retriesLeft > 0) {
        const newTask = {
          ...task.data,
          retriesLeft: task.data.retriesLeft - 1,
        }
        EventRouter.publish(newTask)
      } else {
        if (errorPublishQueue) {
          Rabbit.publish(errorPublishQueue, {
            ...task.data,
            retriesLeft: errorRetries,
          })
        }
        logger.error('Task failed', error)
      }
    }
  }
