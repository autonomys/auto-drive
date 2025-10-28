import { createLogger } from '../drivers/logger.js'
import { Rabbit } from '../drivers/rabbit.js'
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
    const parsingResult = TaskSchema.safeParse(obj)
    if (!parsingResult.success) {
      logger.error(parsingResult.error as Error, 'Invalid task')
      return
    }

    try {
      await handler(parsingResult.data)
    } catch (error) {
      if (parsingResult.data.retriesLeft > 0) {
        const newTask = {
          ...parsingResult.data,
          retriesLeft: parsingResult.data.retriesLeft - 1,
        }
        EventRouter.publish(newTask)
      } else {
        if (errorPublishQueue) {
          Rabbit.publish(errorPublishQueue, {
            ...parsingResult.data,
            retriesLeft: errorRetries,
          })
        }
        logger.error(error as Error, 'Task failed')
      }
    }
  }
