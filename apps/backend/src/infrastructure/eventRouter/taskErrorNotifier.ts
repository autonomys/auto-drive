import { z } from 'zod'
import { config } from '../../config.js'
import { createLogger } from '../drivers/logger.js'
import { slackNotifier } from '../services/slack/index.js'

const logger = createLogger('eventRouter:taskErrorNotifier')

/**
 * Shape of a message on an error queue: the original task plus the failure
 * context added when its retries ran out.
 *
 * Deliberately permissive — this is not re-validated against `TaskSchema`. A
 * message that no longer parses as a known task is exactly the kind of thing
 * worth alerting on, so rejecting it here would hide it.
 */
const FailedTaskSchema = z.object({
  id: z.string(),
  params: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  failedAt: z.string().optional(),
})

export type FailedTask = z.infer<typeof FailedTaskSchema>

interface PendingFailure {
  queue: string
  task: FailedTask
}

let pending: PendingFailure[] = []
let flushTimer: NodeJS.Timeout | null = null

/**
 * Best-effort identifier for the thing that failed, so an alert points at
 * something actionable rather than just a task name.
 */
const subjectOf = (task: FailedTask): string => {
  const params = task.params ?? {}
  for (const key of ['cid', 'downloadId', 'uploadId']) {
    const value = params[key]
    if (typeof value === 'string' && value) {
      return `${key}=${value}`
    }
  }
  if (Array.isArray(params.nodes)) {
    return `nodes=${params.nodes.length}`
  }
  if (Array.isArray(params.objects)) {
    return `objects=${params.objects.length}`
  }
  return 'no subject'
}

const formatBatch = (failures: PendingFailure[]) => {
  const countsByTask = new Map<string, number>()
  for (const { task } of failures) {
    countsByTask.set(task.id, (countsByTask.get(task.id) ?? 0) + 1)
  }

  const breakdown = [...countsByTask.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => `${id}×${count}`)
    .join(', ')

  const title =
    failures.length === 1
      ? `:warning: Task permanently failed: \`${failures[0].task.id}\``
      : `:warning: ${failures.length} tasks permanently failed (${breakdown})`

  const shown = failures.slice(0, config.slack.alertMaxItems)
  const lines = shown.map(({ queue, task }) =>
    [
      `[${queue}] ${task.id} ${subjectOf(task)}`,
      task.error ? `  reason: ${task.error}` : '  reason: <not recorded>',
    ].join('\n'),
  )

  const omitted = failures.length - shown.length
  if (omitted > 0) {
    lines.push(`… and ${omitted} more`)
  }

  return { title, details: lines.join('\n') }
}

const flush = async () => {
  flushTimer = null
  const batch = pending
  pending = []
  if (batch.length === 0) {
    return
  }

  const { title, details } = formatBatch(batch)
  const delivered = await slackNotifier.send({ title, details })
  if (!delivered) {
    // Logged rather than requeued. The queue driver requeues immediately with no
    // backoff, so a failing alert would spin in a hot loop and, worse, block the
    // drain of the very backlog we are trying to report.
    logger.error(
      'Failed to deliver Slack alert for %d permanently failed task(s): %s',
      batch.length,
      details,
    )
  }
}

/**
 * Records a permanently failed task for the next batched alert.
 *
 * Resolves immediately so the queue message is acked: alerting must never hold
 * up the error queue. The trade-off is that an alert can be lost if the process
 * dies inside the batching window — acceptable for a notification, and preferable
 * to a queue that stops draining.
 */
export const handleFailedTask = async (
  queue: string,
  message: Record<string, unknown>,
): Promise<void> => {
  const parsed = FailedTaskSchema.safeParse(message)
  if (!parsed.success) {
    logger.error(
      'Unparseable message on error queue %s: %s',
      queue,
      JSON.stringify(message).slice(0, 500),
    )
    return
  }

  logger.warn(
    'Task %s on %s failed permanently (%s): %s',
    parsed.data.id,
    queue,
    subjectOf(parsed.data),
    parsed.data.error ?? '<reason not recorded>',
  )

  if (!slackNotifier.isEnabled()) {
    return
  }

  pending.push({ queue, task: parsed.data })

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      void flush()
    }, config.slack.alertWindowMs)
    // Do not hold the event loop open on account of a pending alert.
    flushTimer.unref?.()
  }
}

/** Flushes any batched alerts immediately. Exposed for tests and shutdown. */
export const flushTaskErrorAlerts = async () => {
  if (flushTimer) {
    clearTimeout(flushTimer)
  }
  await flush()
}

/** Drops batched state without sending. Tests only. */
export const resetTaskErrorAlerts = () => {
  if (flushTimer) {
    clearTimeout(flushTimer)
  }
  flushTimer = null
  pending = []
}
