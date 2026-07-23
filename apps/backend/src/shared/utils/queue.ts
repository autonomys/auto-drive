import { Rabbit } from '../../infrastructure/drivers/rabbit.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('utils:queue')

const TASK_MANAGER_QUEUE = 'task-manager'

/**
 * Returns true when `queue` holds more than `threshold` pending messages,
 * signalling that callers should defer non-urgent work. Defaults to the
 * task-manager (fast) lane with a zero threshold (defer on any backlog).
 * Callers whose work targets another queue can check it with a higher
 * threshold — e.g. publishing recovery checks publish-manager, which normally
 * holds a shallow backlog while batches await on-chain confirmation, so only a
 * genuine pile-up (not mere non-emptiness) should defer it.
 *
 * On check failure the function returns false (proceed), because a
 * transient RabbitMQ hiccup should not permanently block recovery jobs.
 */
export const isTaskQueueBusy = async (
  callerLabel: string,
  queue: string = TASK_MANAGER_QUEUE,
  threshold: number = 0,
): Promise<boolean> => {
  try {
    const pending = await Rabbit.getMessageCount(queue)
    if (pending > threshold) {
      logger.debug(
        'Deferring %s, %d tasks pending in %s (threshold %d)',
        callerLabel,
        pending,
        queue,
        threshold,
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
