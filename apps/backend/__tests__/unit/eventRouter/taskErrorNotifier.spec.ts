import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { config } from '../../../src/config.js'
import {
  flushTaskErrorAlerts,
  handleFailedTask,
  resetTaskErrorAlerts,
} from '../../../src/infrastructure/eventRouter/taskErrorNotifier.js'
import { slackNotifier } from '../../../src/infrastructure/services/slack/index.js'

const failedTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'async-download-created',
  retriesLeft: 0,
  params: { downloadId: 'dl-1' },
  error: 'Error fetching file header: 404 Not Found',
  failedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
})

describe('taskErrorNotifier', () => {
  const originalWebhook = config.slack.webhookUrl
  const originalMaxItems = config.slack.alertMaxItems
  let send: ReturnType<typeof jest.spyOn>

  beforeEach(() => {
    config.slack.webhookUrl = 'https://hooks.slack.example/T/B/XYZ'
    send = jest
      .spyOn(slackNotifier, 'send')
      .mockResolvedValue(true) as unknown as ReturnType<typeof jest.spyOn>
    resetTaskErrorAlerts()
  })

  afterEach(() => {
    resetTaskErrorAlerts()
    config.slack.webhookUrl = originalWebhook
    config.slack.alertMaxItems = originalMaxItems
    jest.restoreAllMocks()
  })

  it('names the task, its subject and the reason it failed', async () => {
    await handleFailedTask('download-errors', failedTask())
    await flushTaskErrorAlerts()

    expect(send).toHaveBeenCalledTimes(1)
    const message = (send.mock.calls[0] as unknown[])[0] as {
      title: string
      details: string
    }
    expect(message.title).toContain('async-download-created')
    expect(message.details).toContain('downloadId=dl-1')
    expect(message.details).toContain('404 Not Found')
    expect(message.details).toContain('[download-errors]')
  })

  // The whole point of batching: a drained backlog of permanently failed tasks
  // must not post once per message. There were 186 waiting in production.
  it('batches many failures into a single message', async () => {
    for (let i = 0; i < 50; i++) {
      await handleFailedTask('download-errors', {
        ...failedTask(),
        params: { cid: `cid-${i}` },
      })
    }
    await flushTaskErrorAlerts()

    expect(send).toHaveBeenCalledTimes(1)
    const message = (send.mock.calls[0] as unknown[])[0] as { title: string }
    expect(message.title).toContain('50 tasks permanently failed')
    expect(message.title).toContain('async-download-created×50')
  })

  it('lists a bounded number of failures and counts the rest', async () => {
    config.slack.alertMaxItems = 3
    for (let i = 0; i < 10; i++) {
      await handleFailedTask('download-errors', {
        ...failedTask(),
        params: { cid: `cid-${i}` },
      })
    }
    await flushTaskErrorAlerts()

    const message = (send.mock.calls[0] as unknown[])[0] as { details: string }
    expect(message.details).toContain('cid-0')
    expect(message.details).toContain('… and 7 more')
    expect(message.details).not.toContain('cid-9')
  })

  // Slack truncates a body past 40,000 characters, and it truncates the tail —
  // which is where the "and N more" count sits. Neither factor of the batch size
  // is otherwise bounded: a reason is an arbitrary library error message, and
  // the item cap is an environment variable somebody may raise mid-incident.
  it('bounds a single overlong reason', async () => {
    await handleFailedTask(
      'publish-errors',
      failedTask({ error: 'x'.repeat(50_000) }),
    )
    await flushTaskErrorAlerts()

    const message = (send.mock.calls[0] as unknown[])[0] as { details: string }
    expect(message.details.length).toBeLessThan(2000)
    expect(message.details).toContain('see logs')
  })

  it('bounds the whole body and still reports what it left out', async () => {
    config.slack.alertMaxItems = 500
    for (let i = 0; i < 600; i++) {
      await handleFailedTask('download-errors', {
        ...failedTask(),
        params: { cid: `cid-${i}` },
        error: 'y'.repeat(400),
      })
    }
    await flushTaskErrorAlerts()

    const message = (send.mock.calls[0] as unknown[])[0] as { details: string }
    expect(message.details.length).toBeLessThan(40_000)
    // Clamping the body must not eat the count of what was never listed.
    expect(message.details).toContain('… and 100 more')
  })

  // `reason:` is one line in a list of them. An Error carrying a stack, or a
  // wrapped RPC error, arrives with its own newlines and breaks that layout —
  // pushing the rest of the batch down the message.
  it('keeps a multi-line reason on one line', async () => {
    await handleFailedTask(
      'publish-errors',
      failedTask({
        error: '1010: Invalid Transaction\n  at signAndSend\n  at publishNodes',
      }),
    )
    await flushTaskErrorAlerts()

    const message = (send.mock.calls[0] as unknown[])[0] as { details: string }
    const reason = message.details
      .split('\n')
      .find((line) => line.includes('reason:'))
    expect(reason).toContain('1010: Invalid Transaction at signAndSend')
    // One entry, so exactly two lines: the subject and its reason.
    expect(message.details.split('\n')).toHaveLength(2)
  })

  it('reports a missing reason rather than omitting the line', async () => {
    await handleFailedTask('publish-errors', failedTask({ error: undefined }))
    await flushTaskErrorAlerts()

    const message = (send.mock.calls[0] as unknown[])[0] as { details: string }
    expect(message.details).toContain('<not recorded>')
  })

  it('accumulates nothing when alerting is disabled', async () => {
    config.slack.webhookUrl = undefined

    await handleFailedTask('download-errors', failedTask())
    await flushTaskErrorAlerts()

    expect(send).not.toHaveBeenCalled()
  })

  // These two matter because the queue driver requeues immediately and without
  // backoff on a throw. Anything that throws here spins in a hot loop and stops
  // the error queue draining at all.
  it('does not throw on an unparseable message', async () => {
    await expect(
      handleFailedTask('download-errors', { nonsense: true }),
    ).resolves.toBeUndefined()
    await flushTaskErrorAlerts()

    expect(send).not.toHaveBeenCalled()
  })

  it('does not throw when Slack delivery fails', async () => {
    send.mockResolvedValue(false as never)

    await handleFailedTask('download-errors', failedTask())

    await expect(flushTaskErrorAlerts()).resolves.toBeUndefined()
  })

  it('starts a fresh batch after flushing', async () => {
    await handleFailedTask('download-errors', failedTask())
    await flushTaskErrorAlerts()
    await handleFailedTask('download-errors', failedTask())
    await flushTaskErrorAlerts()

    expect(send).toHaveBeenCalledTimes(2)
  })

  // The shutdown sequence is: stop consuming, flush, close the channel, exit. The
  // two races below both end with `process.exit` destroying a batch that had
  // already been taken out of `pending`, so the flush saw nothing left to do.
  describe('shutdown races', () => {
    /** A send whose completion the test controls. */
    const controllableSend = () => {
      let release: (delivered: boolean) => void = () => undefined
      const started = new Promise<void>((resolveStarted) => {
        send.mockImplementation((() => {
          resolveStarted()
          return new Promise<boolean>((resolve) => {
            release = resolve
          })
        }) as never)
      })
      return { started, release: () => release(true) }
    }

    it('waits for a send that is already in flight', async () => {
      const { started, release } = controllableSend()

      await handleFailedTask('download-errors', failedTask())
      // Stand in for the batching window expiring just as SIGTERM lands.
      const timerFlush = flushTaskErrorAlerts()
      await started

      let shutdownFinished = false
      const shutdownFlush = flushTaskErrorAlerts().then(() => {
        shutdownFinished = true
      })

      // The batch is no longer in `pending`, so a naive flush returns here and
      // lets the caller exit while the webhook call is still open. Drained via a
      // macrotask so every pending microtask settles first — a single
      // `await Promise.resolve()` is not enough to distinguish the two, and lets
      // this assertion pass against the very bug it is meant to catch.
      await new Promise((resolve) => setImmediate(resolve))
      expect(shutdownFinished).toBe(false)

      release()
      await Promise.all([timerFlush, shutdownFlush])
      expect(shutdownFinished).toBe(true)
    })

    it('delivers failures that arrive while the final send is awaited', async () => {
      const { started, release } = controllableSend()

      await handleFailedTask('download-errors', failedTask())
      const shutdownFlush = flushTaskErrorAlerts()
      await started

      // A consumer acks one more failure before the channel is closed.
      await handleFailedTask('download-errors', {
        ...failedTask(),
        params: { cid: 'arrived-during-shutdown' },
      })

      send.mockResolvedValue(true as never)
      release()
      await shutdownFlush

      expect(send).toHaveBeenCalledTimes(2)
      const second = (send.mock.calls[1] as unknown[])[0] as { details: string }
      expect(second.details).toContain('arrived-during-shutdown')
    })
  })
})
