import { jest, describe, it, expect } from '@jest/globals'
import {
  shutdownStep,
  startShutdownWatchdog,
} from '../../../src/shared/utils/shutdown.js'
import type { Logger } from '../../../src/infrastructure/drivers/logger.js'

/**
 * A shutdown handler is where an unbounded await is unrecoverable. Without a
 * handler SIGTERM ends the process immediately; adding one turns every await
 * inside it into a way to survive until SIGKILL instead — and the awaits here
 * are broker RPCs that wait on a reply, plus an alert drain that can want ~50s
 * against a 10s stop grace period.
 */

const testLogger = () =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  }) as unknown as Logger

const never = () => new Promise<void>(() => undefined)

describe('shutdownStep', () => {
  it('gives up on a step that never settles', async () => {
    const logger = testLogger()
    const started = Date.now()

    await shutdownStep(logger, 'hangs forever', 100, never)

    expect(Date.now() - started).toBeLessThan(1000)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('does not reject when a step throws, so later steps still run', async () => {
    const logger = testLogger()
    const afterFailure = jest.fn(async () => undefined)

    await expect(
      shutdownStep(logger, 'throws', 100, async () => {
        throw new Error('broker gone')
      }),
    ).resolves.toBeUndefined()
    await shutdownStep(logger, 'runs anyway', 100, afterFailure)

    expect(afterFailure).toHaveBeenCalled()
  })

  it('returns as soon as a step completes', async () => {
    const logger = testLogger()
    const started = Date.now()

    await shutdownStep(logger, 'quick', 5000, async () => undefined)

    expect(Date.now() - started).toBeLessThan(1000)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('startShutdownWatchdog', () => {
  it('fires when the sequence outlives its budget', async () => {
    const logger = testLogger()
    const onExpiry = jest.fn()

    startShutdownWatchdog(logger, 50, onExpiry)
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(onExpiry).toHaveBeenCalled()
  })

  it('stays quiet once the sequence finishes', async () => {
    const logger = testLogger()
    const onExpiry = jest.fn()

    const stop = startShutdownWatchdog(logger, 50, onExpiry)
    stop()
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(onExpiry).not.toHaveBeenCalled()
  })
})
