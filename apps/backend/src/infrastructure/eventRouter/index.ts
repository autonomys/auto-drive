import { Rabbit } from '../drivers/rabbit.js'
import {
  downloadErrorPublishedQueue,
  processDownloadTask,
} from './processors/download.js'
import {
  frontendErrorPublishedQueue,
  processFrontendTask,
} from './processors/frontend.js'
import {
  processPublishTask,
  publishErrorPublishedQueue,
} from './processors/publish.js'
import { Task } from './tasks.js'
import { handleFailedTask } from './taskErrorNotifier.js'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('eventRouter')

/**
 * In-flight subscriptions to the error queues, so shutdown can stop them.
 *
 * Holds the *promises* rather than the resolved unsubscribe handles, and is
 * appended to synchronously. Storing resolved handles left a window between
 * process start and the subscribe resolving in which this list was empty, so a
 * shutdown arriving in that window cancelled nothing and the "stopped consumers"
 * guarantee silently did not hold.
 */
let taskErrorSubscriptions: Array<Promise<() => Promise<void>>> = []

export const EventRouter = {
  listenFrontendEvents: () => {
    Rabbit.subscribe('task-manager', processFrontendTask)
  },
  listenDownloadEvents: () => {
    Rabbit.subscribe('download-manager', processDownloadTask)
  },
  listenPublishEvents: () => {
    Rabbit.subscribe('publish-manager', processPublishTask)
  },
  /**
   * Consumes the error queues and alerts on what lands there.
   *
   * Until now nothing subscribed to them, so a task that exhausted its retries
   * was published to a queue with no reader and stayed there forever — the count
   * was a growing tally of silent failures, not a backlog anything would drain.
   *
   * Safe to call from more than one process: RabbitMQ delivers each message to a
   * single consumer, so extra readers share the work rather than duplicating
   * alerts. The only effect of multiple readers is that a batching window may be
   * split between them, producing two smaller summaries instead of one.
   */
  listenTaskErrors: () => {
    for (const queue of [
      frontendErrorPublishedQueue,
      downloadErrorPublishedQueue,
      publishErrorPublishedQueue,
    ] as const) {
      const subscription = Rabbit.subscribe(queue, (message) =>
        handleFailedTask(queue, message),
      )
      // Tracked synchronously so a shutdown cannot race the subscribe resolving.
      taskErrorSubscriptions.push(subscription)
      // Failures are surfaced (and the rejection handled) here; stopTaskErrors
      // catches its own await of the same promise.
      subscription.catch((error: unknown) => {
        logger.error(error as Error, 'Failed to consume error queue %s', queue)
      })
    }
  },
  /**
   * Cancels the error-queue consumers and waits for the cancels to take effect.
   *
   * Must be awaited before `flushTaskErrorAlerts` on shutdown. Otherwise failures
   * keep being acked while the final send is awaited, landing in a batch created
   * after the flush decided it was finished — which is how a deploy drops exactly
   * the alerts the shutdown flush exists to preserve.
   *
   * Cancelling stops *new* deliveries; a message already handed to the client can
   * still be inside its handler when this resolves. That residue is what the
   * drain passes in `flushTaskErrorAlerts` cover — the two work together, and
   * neither is sufficient alone.
   */
  stopTaskErrors: async () => {
    const subscriptions = taskErrorSubscriptions
    taskErrorSubscriptions = []

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          const unsubscribe = await subscription
          await unsubscribe()
        } catch (error) {
          // A subscribe that never succeeded has nothing to cancel, and a cancel
          // on an already-closed channel is moot. Either way shutdown continues.
          logger.warn(
            error as Error,
            'Failed to cancel an error-queue consumer during shutdown',
          )
        }
      }),
    )
  },
  publish: (tasks: Task[] | Task) => {
    if (Array.isArray(tasks)) {
      tasks.forEach((task) => {
        Rabbit.publish(getTargetQueueByTask(task), task)
      })
    } else {
      Rabbit.publish(getTargetQueueByTask(tasks), tasks)
    }
  },
  publishFailedTask: (task: Task) => {
    Rabbit.publish(getFailedTaskQueue(task), task)
  },
}

const getTargetQueueByTask = (task: Task) => {
  switch (task.id) {
    case 'async-download-created':
    case 'object-archived':
    case 'populate-cache':
      return 'download-manager'
    // On-chain publishing blocks for the confirmation-depth window per batch;
    // route it to a dedicated queue/worker so those waits never hold up the
    // fast frontend tasks on task-manager. publish-nodes and
    // ensure-object-published both sign via the publisher, so they must share
    // the single publish worker (signing-account nonces are per-process).
    case 'publish-nodes':
    case 'ensure-object-published':
      return 'publish-manager'
    default:
      return 'task-manager'
  }
}

const getFailedTaskQueue = (task: Task) => {
  switch (getTargetQueueByTask(task)) {
    case 'task-manager':
      return frontendErrorPublishedQueue
    case 'download-manager':
      return downloadErrorPublishedQueue
    case 'publish-manager':
      return publishErrorPublishedQueue
    default:
      throw new Error(`Unknown task: ${task.id}`)
  }
}
