import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import { Rabbit } from '../../../src/infrastructure/drivers/rabbit.js'
import { config } from '../../../src/config.js'

const ERROR_QUEUES = ['frontend-errors', 'download-errors', 'publish-errors']

describe('EventRouter task-error consumers', () => {
  const originalWebhook = config.slack.webhookUrl

  beforeEach(() => {
    config.slack.webhookUrl = 'https://hooks.slack.example/T/B/XYZ'
  })

  afterEach(() => {
    config.slack.webhookUrl = originalWebhook
    jest.restoreAllMocks()
  })

  it('subscribes to all three error queues', async () => {
    const subscribe = jest
      .spyOn(Rabbit, 'subscribe')
      .mockResolvedValue(async () => undefined)

    EventRouter.listenTaskErrors()
    await EventRouter.stopTaskErrors()

    expect(subscribe.mock.calls.map((call) => call[0])).toEqual(ERROR_QUEUES)
  })

  // The handles used to be collected in a `.then`, so between process start and
  // the subscribe resolving this list was empty — a shutdown in that window
  // cancelled nothing while reporting that consumers were stopped.
  it('cancels consumers whose subscribe has not resolved yet', async () => {
    const cancelled: string[] = []
    const releases: Array<() => void> = []

    jest.spyOn(Rabbit, 'subscribe').mockImplementation(((queue: string) => {
      return new Promise((resolve) => {
        releases.push(() =>
          resolve(async () => {
            cancelled.push(queue)
          }),
        )
      })
    }) as never)

    EventRouter.listenTaskErrors()

    // Shutdown begins before any subscribe has resolved.
    const stopping = EventRouter.stopTaskErrors()
    releases.forEach((release) => release())
    await stopping

    expect(cancelled.sort()).toEqual([...ERROR_QUEUES].sort())
  })

  // `channel.cancel` is asynchronous, so a fire-and-forget unsubscribe would let
  // shutdown proceed to the flush while deliveries were still arriving.
  it('waits for each cancel to complete', async () => {
    let cancelsFinished = 0
    // One resolver per consumer: the three cancels run concurrently, so a single
    // shared resolver would leave two of them hanging.
    const releases: Array<() => void> = []

    jest.spyOn(Rabbit, 'subscribe').mockResolvedValue(
      (async () => {
        await new Promise<void>((resolve) => {
          releases.push(resolve)
        })
        cancelsFinished++
      }) as never,
    )

    EventRouter.listenTaskErrors()

    let stopResolved = false
    const stopping = EventRouter.stopTaskErrors().then(() => {
      stopResolved = true
    })

    await new Promise((resolve) => setImmediate(resolve))
    expect(releases).toHaveLength(ERROR_QUEUES.length)
    // A fire-and-forget unsubscribe would have let shutdown continue by now.
    expect(stopResolved).toBe(false)
    expect(cancelsFinished).toBe(0)

    releases.forEach((release) => release())
    await stopping
    expect(cancelsFinished).toBe(ERROR_QUEUES.length)
  })

  it('continues shutting down when a subscribe never succeeded', async () => {
    jest
      .spyOn(Rabbit, 'subscribe')
      .mockRejectedValue(new Error('channel closed'))

    EventRouter.listenTaskErrors()

    await expect(EventRouter.stopTaskErrors()).resolves.toBeUndefined()
  })

  // Consuming acks each failure off a durable queue. With no webhook configured
  // there is nowhere for the alert to go, so consuming would reduce the backlog
  // to log lines and destroy the only copy that outlives a log rotation.
  it('does not consume anything when Slack alerting is unconfigured', async () => {
    config.slack.webhookUrl = undefined
    const subscribe = jest
      .spyOn(Rabbit, 'subscribe')
      .mockResolvedValue(async () => undefined)

    EventRouter.listenTaskErrors()
    await EventRouter.stopTaskErrors()

    expect(subscribe).not.toHaveBeenCalled()
  })
})
