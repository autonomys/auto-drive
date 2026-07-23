import { Rabbit } from '../../infrastructure/drivers/rabbit.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('utils:queue')

const TASK_MANAGER_QUEUE = 'task-manager'

/**
 * Returns true when the task-manager queue has pending messages,
 * signalling that callers should defer non-urgent work.
 *
 * On check failure the function returns false (proceed), because a
 * transient RabbitMQ hiccup should not permanently block recovery jobs.
 */
export const isTaskQueueBusy = async (
  callerLabel: string,
): Promise<boolean> => {
  try {
    const pending = await Rabbit.getMessageCount(TASK_MANAGER_QUEUE)
    if (pending > 0) {
      logger.debug(
        'Deferring %s, %d tasks pending in queue',
        callerLabel,
        pending,
      )
      return true
    }
  } catch (error) {
    logger.warn(
      'Failed to check queue depth, proceeding: %s',
      error instanceof Error ? error.message : String(error),
    )
  }
  return false
}
