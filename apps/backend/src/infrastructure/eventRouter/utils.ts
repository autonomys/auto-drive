import { createLogger } from '../drivers/logger.js'
import { Rabbit } from '../drivers/rabbit.js'
import { EventRouter } from './index.js'
import { Task, TaskSchema } from './tasks.js'
import { withTimeout, TimeoutError } from '../../shared/utils/timeout.js'

const logger = createLogger('eventRouter:utils')

type Handler = (task: Task, signal: AbortSignal) => Promise<unknown>

export const createHandlerWithRetries =
  (
    handler: Handler,
    {
      errorPublishQueue = 'errors',
      errorRetries = 3,
      taskTimeoutMs = 0,
    }: {
      errorPublishQueue?: string | null
      errorRetries?: number
      taskTimeoutMs?: number
    } = {},
  ) =>
  async (obj: unknown) => {
    const parsingResult = TaskSchema.safeParse(obj)
    if (!parsingResult.success) {
      logger.error(parsingResult.error as Error, 'Invalid task')
      return
    }

    const abortController = new AbortController()

    try {
      const handlerPromise = handler(parsingResult.data, abortController.signal)
      if (taskTimeoutMs > 0) {
        await withTimeout(
          handlerPromise,
          taskTimeoutMs,
          `task:${parsingResult.data.id}`,
          abortController,
        )
      } else {
        await handlerPromise
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        abortController.abort(error)
      }
      if (error instanceof TimeoutError) {
        logger.warn(
          'Task %s timed out after %dms (retriesLeft=%d)',
          parsingResult.data.id,
          taskTimeoutMs,
          parsingResult.data.retriesLeft,
        )
      }
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
