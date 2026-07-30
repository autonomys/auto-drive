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
})
