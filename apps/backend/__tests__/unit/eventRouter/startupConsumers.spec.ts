import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals'

/**
 * The startup path, for a worker that comes up before the broker does.
 *
 * `Rabbit.subscribe` re-raises a `consume` that failed, and the `listen*Events`
 * helpers are called from a server entry point with no caller to return to. A
 * floated subscribe promise there is the same mistake the reconnect loop and the
 * keepalive interval each made (see rabbitReconnect.spec.ts): nothing in the
 * backend registers an `unhandledRejection` handler and Node defaults to
 * `--unhandled-rejections=throw`, so it kills the worker — on the one code path
 * where the broker being briefly unreachable is entirely expected.
 *
 * Recovering rather than crashing is only worth anything because the driver now
 * clears a rejected channel: the callback is registered in `subscriptions` before
 * the channel is awaited, so the next keepalive tick opens a fresh channel and
 * restores the consumer. The second test is that half.
 */

process.env.RABBITMQ_KEEP_ALIVE_INTERVAL = '20'

const consumedQueues: string[] = []
let failConnect = true

jest.unstable_mockModule('amqplib', () => ({
  connect: jest.fn(async () => {
    if (failConnect) {
      throw new Error('ECONNREFUSED: broker unreachable')
    }
    return {
      createChannel: async () => ({
        assertQueue: jest.fn(),
        prefetch: jest.fn(),
        ack: jest.fn(),
        nack: jest.fn(),
        sendToQueue: jest.fn(),
        consume: async (queue: string) => {
          consumedQueues.push(queue)
          return { consumerTag: `tag-${consumedQueues.length}` }
        },
        cancel: async () => undefined,
        checkQueue: async () => ({ messageCount: 0 }),
        close: async () => undefined,
      }),
      close: async () => undefined,
    }
  }),
}))

const { EventRouter } = await import(
  '../../../src/infrastructure/eventRouter/index.js'
)
const { Rabbit } = await import('../../../src/infrastructure/drivers/rabbit.js')

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (predicate: () => boolean, timeout = 5000) => {
  for (let waited = 0; waited < timeout && !predicate(); waited += 20) {
    await tick(20)
  }
  return predicate()
}

describe('EventRouter startup consumers', () => {
  const unhandled: unknown[] = []
  const record = (reason: unknown) => unhandled.push(reason)

  beforeAll(() => {
    process.on('unhandledRejection', record)
  })

  afterAll(async () => {
    process.off('unhandledRejection', record)
    await Rabbit.close().catch(() => undefined)
  })

  it('survives a broker that is not up yet', async () => {
    failConnect = true

    EventRouter.listenFrontendEvents()
    EventRouter.listenDownloadEvents()
    EventRouter.listenPublishEvents()

    // Long enough for the failing connects to settle and for Node to have made
    // up its mind about whether anything handled them.
    await tick(200)

    expect(unhandled).toEqual([])
  })

  it('picks the queues up once the broker is reachable', async () => {
    failConnect = false

    // Nothing re-runs `listen*Events`; the keepalive tick is what reconnects, and
    // the re-subscribe loop restores the callbacks registered by the failed
    // subscribes above.
    expect(
      await waitFor(() =>
        ['task-manager', 'download-manager', 'publish-manager'].every((queue) =>
          consumedQueues.includes(queue),
        ),
      ),
    ).toBe(true)
    expect(unhandled).toEqual([])
  }, 10000)
})
