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
 * The send currently in progress.
 *
 * Tracked so a shutdown can *await* a send rather than abort it: a batch is
 * removed from `pending` before the webhook call starts, so a `process.exit`
 * landing mid-send would take the batch with it while `pending` looked empty.
 */
let inFlightFlush: Promise<void> | null = null

/**
 * Passes the shutdown drain will make before giving up.
 *
 * More than one is needed because the error-queue consumers stay active while a
 * send is awaited, so failures acked during that wait land in a fresh batch.
 * Bounded so a steady stream of failures cannot hold shutdown open forever.
 */
const MAX_DRAIN_PASSES = 5

/**
 * Caps on the size of an alert body.
 *
 * Slack truncates a message past 40,000 characters, and a wall of text stops
 * being readable long before that. The number of items is already capped by
 * `alertMaxItems`, but neither half of the product is otherwise bounded: a
 * reason is whatever `Error.message` a library produced — a polkadot RPC error
 * can carry a hex-encoded extrinsic — and `alertMaxItems` is an environment
 * variable somebody may well raise mid-incident, which is when batches are
 * largest.
 *
 * Nothing is lost to a clamp: every failure is logged in full as it arrives,
 * and a batch that fails to deliver is logged in full as well.
 */
const MAX_REASON_CHARS = 500
const MAX_DETAILS_CHARS = 8000

const clamp = (text: string, limit: number) =>
  text.length > limit
    ? `${text.slice(0, limit)}… [+${text.length - limit} chars, see logs]`
    : text

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
      task.error
        ? `  reason: ${clamp(task.error, MAX_REASON_CHARS)}`
        : '  reason: <not recorded>',
    ].join('\n'),
  )

  // Clamped before the "and N more" marker is appended rather than after:
  // truncation takes the tail, which is where that marker would sit, and it is
  // the one line telling a reader the batch was larger than what they can see.
  const body = clamp(lines.join('\n'), MAX_DETAILS_CHARS)

  const omitted = failures.length - shown.length

  return {
    title,
    details: omitted > 0 ? `${body}\n… and ${omitted} more` : body,
  }
}

const deliverBatch = async () => {
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
 * Sends the current batch, serialised against any send already in progress.
 *
 * Serialisation matters because two callers can arrive at once — a window expiry
 * and a shutdown — and each takes the whole of `pending`. Running them
 * concurrently would split one batch across two messages, or lose one entirely
 * if the process exits while the second is still queued behind the first.
 */
const flush = (): Promise<void> => {
  const previous = inFlightFlush ?? Promise.resolve()
  const run = previous
    .catch(() => undefined)
    .then(deliverBatch)
    .catch((error) => {
      logger.error(error as Error, 'Failed to flush task error alerts')
    })

  inFlightFlush = run
  void run.finally(() => {
    if (inFlightFlush === run) {
      inFlightFlush = null
    }
  })

  return run
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

/**
 * Sends everything batched, for shutdown and tests.
 *
 * Drains in passes rather than flushing once. Two things make a single flush
 * insufficient:
 *
 * - A send already in progress has taken its batch out of `pending`, so a single
 *   `flush()` would see nothing to do and return immediately, letting the caller
 *   proceed to `process.exit` and kill that send.
 * - The error-queue consumers keep acking failures while a send is awaited, and
 *   those land in a fresh batch behind it.
 *
 * Callers should stop the consumers first (`EventRouter.stopTaskErrors`) so the
 * second case is bounded; the passes are belt-and-braces for messages whose
 * handler was already running when the consumer was cancelled.
 */
export const flushTaskErrorAlerts = async () => {
  for (let pass = 0; pass < MAX_DRAIN_PASSES; pass++) {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }

    // Never let the caller exit out from under a send that already cleared its
    // batch — that is the one way a batch disappears without being delivered.
    if (inFlightFlush) {
      await inFlightFlush
    }

    if (pending.length === 0) {
      return
    }

    await flush()
  }

  if (pending.length > 0) {
    // Not silent: each of these was already logged individually as it arrived,
    // so the failures survive in the logs even though the alert did not.
    logger.error(
      'Gave up flushing %d task error alert(s) after %d passes; they remain in the logs only',
      pending.length,
      MAX_DRAIN_PASSES,
    )
  }
}

/** Drops batched state without sending. Tests only. */
export const resetTaskErrorAlerts = () => {
  if (flushTimer) {
    clearTimeout(flushTimer)
  }
  flushTimer = null
  pending = []
  inFlightFlush = null
}
