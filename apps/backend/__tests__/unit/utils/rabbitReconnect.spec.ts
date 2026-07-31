import { jest, describe, it, expect, beforeEach } from '@jest/globals'

/**
 * Covers consumer bookkeeping in the Rabbit driver: one live consumer per
 * (queue, callback), and an unsubscribe that cancels whichever consumer is live
 * now rather than the one it was handed at subscribe time.
 *
 * Two paths establish consumers and they overlap. `subscribe` registers its
 * callback in `subscriptions` *before* awaiting `getChannel`, and `getChannel`
 * re-subscribes everything in `subscriptions` once its channel resolves — that
 * loop exists to restore consumers after a reconnect, but on a cold channel it
 * also picks up the subscribe still in flight. Both then consumed, and the
 * survivor in the driver's bookkeeping was whichever finished last: the other
 * consumer stayed live with nobody holding its tag, so `unsubscribe` (and hence
 * `EventRouter.stopTaskErrors`) left it delivering.
 *
 * `amqplib` is mocked because the reconnect is internal — keepAlive owns the
 * cached channel, so the only way to force one is to make its liveness probe
 * fail. The keepalive interval is shortened for the same reason.
 */

process.env.RABBITMQ_KEEP_ALIVE_INTERVAL = '20'

interface FakeChannel {
  id: number
  closed: boolean
  liveConsumers: Set<string>
}

const channels: FakeChannel[] = []
const consumerTags: { tag: string; channel: number; queue: string }[] = []
const cancelledTags: string[] = []
let nextConsumerTag = 0
let failCheckQueue = false

jest.unstable_mockModule('amqplib', () => ({
  connect: jest.fn(async () => ({
    createChannel: async () => {
      const channel = {
        id: channels.length,
        closed: false,
        liveConsumers: new Set<string>(),
        assertQueue: jest.fn(),
        prefetch: jest.fn(),
        ack: jest.fn(),
        nack: jest.fn(),
        sendToQueue: jest.fn(),
        consume: async (queue: string) => {
          const consumerTag = `tag-${nextConsumerTag++}`
          channel.liveConsumers.add(consumerTag)
          consumerTags.push({ tag: consumerTag, channel: channel.id, queue })
          return { consumerTag }
        },
        cancel: async (tag: string) => {
          if (channel.closed) {
            throw new Error('channel closed')
          }
          cancelledTags.push(tag)
          channel.liveConsumers.delete(tag)
        },
        checkQueue: async () => {
          if (failCheckQueue) {
            throw new Error('keepalive probe failed')
          }
          return { messageCount: 0 }
        },
        close: async () => {
          channel.closed = true
          // A closed channel takes its consumers with it.
          channel.liveConsumers.clear()
        },
      }
      channels.push(channel)
      return channel
    },
    close: async () => undefined,
  })),
}))

const { Rabbit } = await import('../../../src/infrastructure/drivers/rabbit.js')

/** Consumers the broker would still be delivering to. */
const liveConsumers = () =>
  channels.filter((c) => !c.closed).flatMap((c) => [...c.liveConsumers])

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Forces the keepalive probe to fail, which tears down and rebuilds the channel. */
const forceReconnect = async () => {
  const channelCount = channels.length
  failCheckQueue = true
  for (let i = 0; i < 100 && channels.length === channelCount; i++) {
    await tick(10)
  }
  failCheckQueue = false
  expect(channels.length).toBeGreaterThan(channelCount)
  // Let the re-subscribe loop settle.
  await tick(20)
}

describe('Rabbit consumer lifecycle', () => {
  beforeEach(async () => {
    await Rabbit.close().catch(() => undefined)
    failCheckQueue = false
    channels.length = 0
    consumerTags.length = 0
    cancelledTags.length = 0
  })

  it('opens exactly one consumer per subscribe on a cold channel', async () => {
    const callback = jest.fn(async () => undefined)

    await Rabbit.subscribe('download-errors', callback as never)
    // The re-subscribe loop runs off the channel promise, so give it a turn.
    await tick(20)

    // Pre-fix: two — the subscribe and getChannel's re-subscribe loop each
    // consumed, and only one of them was cancellable afterwards.
    expect(consumerTags).toHaveLength(1)
    expect(liveConsumers()).toHaveLength(1)
  })

  it('opens one consumer each when several subscribes race the same cold channel', async () => {
    const callbacks = [
      jest.fn(async () => undefined),
      jest.fn(async () => undefined),
      jest.fn(async () => undefined),
    ]

    await Promise.all([
      Rabbit.subscribe('download-errors', callbacks[0] as never),
      Rabbit.subscribe('frontend-errors', callbacks[1] as never),
      Rabbit.subscribe('publish-errors', callbacks[2] as never),
    ])
    await tick(20)

    expect(liveConsumers()).toHaveLength(3)
  })

  it('leaves no consumer behind that unsubscribe cannot reach', async () => {
    const callback = jest.fn(async () => undefined)

    const unsubscribe = await Rabbit.subscribe(
      'download-errors',
      callback as never,
    )
    await tick(20)

    await unsubscribe()

    // The guarantee EventRouter.stopTaskErrors depends on: once this resolves,
    // nothing is still being delivered to the callback.
    expect(liveConsumers()).toHaveLength(0)
  })

  it('keeps one live consumer across a reconnect', async () => {
    const callback = jest.fn(async () => undefined)

    await Rabbit.subscribe('download-errors', callback as never)
    await tick(20)

    await forceReconnect()

    // The reconnect restores the consumer on the new channel — and only there.
    expect(liveConsumers()).toHaveLength(1)
  })

  it('cancels the consumer that is live now, not the one it was handed', async () => {
    const callback = jest.fn(async () => undefined)

    const unsubscribe = await Rabbit.subscribe(
      'download-errors',
      callback as never,
    )
    await tick(20)
    const tagsBeforeReconnect = consumerTags.map(({ tag }) => tag)

    await forceReconnect()

    const liveTag = liveConsumers()[0]
    expect(tagsBeforeReconnect).not.toContain(liveTag)

    await unsubscribe()

    // Pre-fix this cancelled a tag from the first subscribe and left the live
    // consumer delivering.
    expect(cancelledTags).toContain(liveTag)
    expect(liveConsumers()).toHaveLength(0)
  })

  it('deregisters the callback so a later reconnect cannot resurrect it', async () => {
    const callback = jest.fn(async () => undefined)

    const unsubscribe = await Rabbit.subscribe(
      'download-errors',
      callback as never,
    )
    await unsubscribe()

    // A second unsubscribe has nothing left to cancel and must not throw.
    await expect(unsubscribe()).resolves.toBeUndefined()

    await forceReconnect()
    expect(liveConsumers()).toHaveLength(0)
  })
})
