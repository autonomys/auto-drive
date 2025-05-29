import { logger } from '../../drivers/logger.js'
import { EventRouter } from './index.js'
import { Task, TaskSchema } from './tasks.js'

type Handler = (task: Task) => Promise<unknown>

export const createHandlerWithRetries =
  (handler: Handler) => async (obj: unknown) => {
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
        logger.error('Task failed', error)
      }
    }
  }
