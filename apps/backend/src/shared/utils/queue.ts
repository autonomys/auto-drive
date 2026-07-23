import { Rabbit } from '../../infrastructure/drivers/rabbit.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('utils:queue')

const TASK_MANAGER_QUEUE = 'task-manager'

/**
 * Returns true when any of the given queues has pending messages, signalling
 * that callers should defer non-urgent work. Defaults to the task-manager
 * (fast) lane; callers whose work lands on another queue — e.g. publishing
 * recovery, whose publish-nodes tasks run on publish-manager — should pass
 * that queue too so they don't keep deepening a backlog that isn't draining.
 *
 * On check failure the function returns false (proceed), because a
 * transient RabbitMQ hiccup should not permanently block recovery jobs.
 */
export const isTaskQueueBusy = async (
  callerLabel: string,
  queues: readonly string[] = [TASK_MANAGER_QUEUE],
): Promise<boolean> => {
  try {
    for (const queue of queues) {
      const pending = await Rabbit.getMessageCount(queue)
      if (pending > 0) {
        logger.debug(
          'Deferring %s, %d tasks pending in %s',
          callerLabel,
          pending,
          queue,
        )
        return true
      }
    }
  } catch (error) {
    logger.warn(
      'Failed to check queue depth, proceeding: %s',
      error instanceof Error ? error.message : String(error),
    )
  }
  return false
}
