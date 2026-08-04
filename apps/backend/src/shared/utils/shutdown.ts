import { Logger } from '../../infrastructure/drivers/logger.js'
import { withTimeout } from './timeout.js'

/**
 * How long a whole shutdown sequence may take.
 *
 * Sized against the container's stop grace period, not against how long the
 * steps would like: nothing in `docker-compose.prod.yml` sets
 * `stop_grace_period`, so every worker gets Docker's default 10 seconds between
 * SIGTERM and SIGKILL. A budget above that is not a budget — the kernel enforces
 * its own, less politely. Raise both together if a sequence ever needs longer.
 */
const DEFAULT_SHUTDOWN_BUDGET_MS = 9_000

/**
 * Arms a timer that exits the process if shutdown has not finished in time.
 *
 * A shutdown handler is the one place where awaiting something unbounded is
 * unrecoverable: before a handler exists SIGTERM terminates the process at once,
 * and adding one replaces that with "runs until SIGKILL" whenever a step hangs.
 * `stopShutdownWatchdog` on the happy path; the timer is unref'd so it never
 * keeps an otherwise-finished process alive.
 *
 * `onExpiry` exists so tests can observe expiry without exiting the runner.
 */
export const startShutdownWatchdog = (
  logger: Logger,
  budgetMs: number = DEFAULT_SHUTDOWN_BUDGET_MS,
  onExpiry: () => void = () => process.exit(1),
) => {
  const watchdog = setTimeout(() => {
    logger.warn(
      'Shutdown did not finish within %dms; exiting without completing it',
      budgetMs,
    )
    onExpiry()
  }, budgetMs)
  watchdog.unref()

  return () => clearTimeout(watchdog)
}

/**
 * Runs one step of a shutdown, bounded, and never rejects.
 *
 * Both properties matter for the same reason: the steps are independent, and a
 * step that hangs or throws must not take the ones behind it with it. Cancelling
 * a consumer and closing a channel are broker RPCs that wait for a reply, so an
 * unreachable broker or a half-open socket stalls them until amqplib's heartbeat
 * notices — two missed intervals, ~120s at the negotiated default — while
 * flushing alerts talks to Slack and would have succeeded regardless.
 *
 * A step cut short is reported, not silently dropped, and for alerting the
 * underlying failures are in the logs either way.
 */
export const shutdownStep = async (
  logger: Logger,
  label: string,
  timeoutMs: number,
  run: () => Promise<unknown>,
): Promise<void> => {
  try {
    await withTimeout(run(), timeoutMs, label)
  } catch (error) {
    logger.warn(error as Error, 'Shutdown step did not complete: %s', label)
  }
}
