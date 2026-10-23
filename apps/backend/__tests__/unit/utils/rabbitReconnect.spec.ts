import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
} from '@jest/globals'
import { EventEmitter } from 'events'

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

type ConsumeHandler = (message: FakeMessage | null) => Promise<void>

interface FakeMessage {
  content: Buffer
  fields: { deliveryTag: number; redelivered: boolean }
}

interface FakeChannel extends EventEmitter {
  id: number
  closed: boolean
  liveConsumers: Set<string>
  handlers: Map<string, ConsumeHandler>
  ack: jest.Mock<(message: FakeMessage) => void>
  nack: jest.Mock<(message: FakeMessage) => void>
}

const channels: FakeChannel[] = []
const consumerTags: { tag: string; channel: number; queue: string }[] = []
const cancelledTags: string[] = []
let nextConsumerTag = 0
let failCheckQueue = false
let failConnect = false
let consumeFailuresLeft = 0

// amqplib throws IllegalOperationError for any send on a closed channel.
const throwIfClosed = (channel: FakeChannel) => {
  if (channel.closed) {
    throw new Error('Channel closed')
  }
}

jest.unstable_mockModule('amqplib', () => ({
  connect: jest.fn(async () => {
    if (failConnect) {
      throw new Error('ECONNREFUSED: broker unreachable')
    }
    return Object.assign(new EventEmitter(), {
      createChannel: async () => {
        const channel: FakeChannel = Object.assign(new EventEmitter(), {
          id: channels.length,
          closed: false,
          liveConsumers: new Set<string>(),
          handlers: new Map<string, ConsumeHandler>(),
          assertQueue: jest.fn(),
          prefetch: jest.fn(),
          ack: jest.fn(() => throwIfClosed(channel)),
          nack: jest.fn(() => throwIfClosed(channel)),
          sendToQueue: jest.fn(),
          consume: async (queue: string, handler: ConsumeHandler) => {
            if (consumeFailuresLeft > 0) {
              consumeFailuresLeft--
              throw new Error(`consume rejected on ${queue}`)
            }
            const consumerTag = `tag-${nextConsumerTag++}`
            channel.liveConsumers.add(consumerTag)
            channel.handlers.set(queue, handler)
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
            channel.emit('close')
          },
        })
        channels.push(channel)
        return channel
      },
      close: async () => undefined,
    })
  }),
}))

/**
 * What amqplib does on a server-initiated Channel.Close, such as the broker's
 * delivery acknowledgement timeout: 'error' on the channel, then 'close'.
 */
const brokerClosesChannel = (channel: FakeChannel) => {
  const error = Object.assign(
    new Error(
      'Channel closed by server: 406 (PRECONDITION-FAILED) with message "PRECONDITION_FAILED - delivery acknowledgement on channel 1 timed out. Timeout value used: 1800000 ms."',
    ),
    { code: 406 },
  )
  channel.emit('error', error)
  channel.closed = true
  channel.liveConsumers.clear()
  channel.emit('close')
}

const { Rabbit } = await import('../../../src/infrastructure/drivers/rabbit.js')

/** Consumers the broker would still be delivering to. */
const liveConsumers = () =>
  channels.filter((c) => !c.closed).flatMap((c) => [...c.liveConsumers])

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits for `predicate`, so a retry with backoff does not need a fixed sleep. */
const waitFor = async (predicate: () => boolean, timeout = 6000) => {
  for (let waited = 0; waited < timeout && !predicate(); waited += 20) {
    await tick(20)
  }
  return predicate()
}

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
    failConnect = false
    consumeFailuresLeft = 0
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

/**
 * A reconnect used to have three ways of taking the worker down with it, all of
 * them the same mistake: a promise created inside the driver that nothing ever
 * awaits. Nothing in the backend registers an `unhandledRejection` handler and
 * Node defaults to `--unhandled-rejections=throw`, so each one is fatal, and
 * they fire exactly when the broker is already having a bad day.
 *
 * These tests exercise the failures behind them. Their real assertion is that
 * the driver comes back — a regression puts the crash in the test run itself.
 */
describe('Rabbit reconnect resilience', () => {
  beforeEach(async () => {
    await Rabbit.close().catch(() => undefined)
    failCheckQueue = false
    failConnect = false
    consumeFailuresLeft = 0
    channels.length = 0
    consumerTags.length = 0
    cancelledTags.length = 0
  })

  it('retries a consume that fails while restoring a consumer', async () => {
    const callback = jest.fn(async () => undefined)
    await Rabbit.subscribe('download-errors', callback as never)
    await tick(20)

    // The re-subscribe loop discards what `subscribe` returns, so this rejection
    // had no caller to reach.
    consumeFailuresLeft = 1
    await forceReconnect()

    // And nothing re-ran the loop: `subscriptions` is only read on a reconnect,
    // and a healthy channel never produces another one — so a single failure
    // left the queue unread until the next unrelated outage.
    expect(await waitFor(() => liveConsumers().length === 1)).toBe(true)
  }, 15000)

  it('reconnects once the broker comes back', async () => {
    const callback = jest.fn(async () => undefined)
    await Rabbit.subscribe('download-errors', callback as never)
    await tick(20)

    // Broker goes away mid-flight: the probe fails, and so does the reconnect.
    failConnect = true
    failCheckQueue = true
    await tick(100)

    const channelsWhileDown = channels.length
    failConnect = false
    failCheckQueue = false

    // The rejected channel used to stay cached, so every later publish, consume
    // and keepalive replayed that one error and no reconnect was ever attempted
    // again — the worker stayed wedged long after the broker was healthy.
    expect(await waitFor(() => channels.length > channelsWhileDown)).toBe(true)
    expect(await waitFor(() => liveConsumers().length === 1)).toBe(true)
    await expect(Rabbit.getMessageCount('download-errors')).resolves.toBe(0)
  }, 15000)

  it('does not resurrect a consumer unsubscribed while its retry is pending', async () => {
    const callback = jest.fn(async () => undefined)
    const unsubscribe = await Rabbit.subscribe(
      'download-errors',
      callback as never,
    )
    await tick(20)

    consumeFailuresLeft = 1
    await forceReconnect()

    // Unsubscribing between the failed attempt and the retry: the callback is
    // deregistered, so the retry must leave it alone rather than hand the queue
    // a consumer nobody holds a handle to.
    await unsubscribe()

    await tick(3000)
    expect(liveConsumers()).toHaveLength(0)
  }, 15000)
})

/**
 * The broker closes a channel by itself when a delivery stays unacknowledged
 * past its consumer_timeout. Every delivery tag on that channel dies with it: the
 * broker requeues those messages and hands them out again on the next channel,
 * while the handlers that received them are still running here.
 */
describe('Rabbit channel closed by the broker', () => {
  const QUEUE = 'task-manager'
  const unhandled: unknown[] = []
  const record = (reason: unknown) => unhandled.push(reason)
  let nextDeliveryTag = 1

  beforeAll(() => {
    process.on('unhandledRejection', record)
  })

  afterAll(() => {
    process.off('unhandledRejection', record)
  })

  beforeEach(async () => {
    await Rabbit.close().catch(() => undefined)
    failCheckQueue = false
    failConnect = false
    consumeFailuresLeft = 0
    channels.length = 0
    consumerTags.length = 0
    cancelledTags.length = 0
    unhandled.length = 0
  })

  const deliver = (channel: FakeChannel, body: object, redelivered = false) => {
    const message: FakeMessage = {
      content: Buffer.from(JSON.stringify(body)),
      fields: { deliveryTag: nextDeliveryTag++, redelivered },
    }
    return { message, settled: channel.handlers.get(QUEUE)!(message) }
  }

  const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => (resolve = r))
    return { promise, resolve }
  }

  const subscribe = async (callback: () => Promise<void>) => {
    const mock = jest.fn(callback)
    await Rabbit.subscribe(QUEUE, mock as never)
    await tick(20)
    return mock
  }

  const waitForReplacement = async (closed: FakeChannel) => {
    expect(
      await waitFor(
        () =>
          channels.length > closed.id + 1 &&
          channels.at(-1)!.handlers.has(QUEUE),
      ),
    ).toBe(true)
    return channels.at(-1)!
  }

  it('reconnects and restores the consumer instead of crashing', async () => {
    await subscribe(async () => undefined)
    const first = channels.at(-1)!

    // Pre-fix this emit threw: nothing listened for 'error', and amqplib turns
    // that into an unhandled 'error' on the connection.
    brokerClosesChannel(first)
    const second = await waitForReplacement(first)

    expect(second.liveConsumers.size).toBe(1)
    expect(liveConsumers()).toHaveLength(1)
  })

  it('does not settle a delivery on the channel that lost it', async () => {
    const gate = deferred()
    await subscribe(() => gate.promise)
    const first = channels.at(-1)!
    const { settled } = deliver(first, { id: 'tag-upload', cid: 'a' })

    brokerClosesChannel(first)
    await waitForReplacement(first)
    gate.resolve()

    // Pre-fix the ack threw on the closed channel, then so did the nack in its
    // catch, and the rejection escaped the consume callback.
    await expect(settled).resolves.toBeUndefined()
    expect(first.ack).not.toHaveBeenCalled()
    expect(first.nack).not.toHaveBeenCalled()
    await tick(20)
    expect(unhandled).toHaveLength(0)
  })

  it('runs messages redelivered while their first run is still going exactly once', async () => {
    const gate = deferred()
    const callback = await subscribe(() => gate.promise)
    const first = channels.at(-1)!
    const bodies = [
      { id: 'migrate-upload-nodes', params: { uploadId: 'u-1' } },
      { id: 'migrate-upload-nodes', params: { uploadId: 'u-2' } },
    ]
    const originals = bodies.map((body) => deliver(first, body))
    expect(callback).toHaveBeenCalledTimes(2)

    brokerClosesChannel(first)
    const second = await waitForReplacement(first)
    const redeliveries = bodies.map((body) => deliver(second, body, true))
    await tick(20)

    expect(callback).toHaveBeenCalledTimes(2)
    // Not acked yet either: the work they stand for has not finished.
    expect(second.ack).not.toHaveBeenCalled()

    gate.resolve()
    await Promise.all([...originals, ...redeliveries].map((d) => d.settled))

    expect(callback).toHaveBeenCalledTimes(2)
    for (const { message } of redeliveries) {
      expect(second.ack).toHaveBeenCalledWith(message)
    }
    expect(first.ack).not.toHaveBeenCalled()
  })

  it('acks the redelivery of work that finished while disconnected without running it again', async () => {
    const gate = deferred()
    const callback = await subscribe(() => gate.promise)
    const first = channels.at(-1)!
    const body = { id: 'tag-upload', params: { cid: 'b' } }
    const original = deliver(first, body)

    brokerClosesChannel(first)
    gate.resolve()
    await original.settled

    const second = await waitForReplacement(first)
    const redelivery = deliver(second, body, true)
    await redelivery.settled

    expect(callback).toHaveBeenCalledTimes(1)
    expect(second.ack).toHaveBeenCalledWith(redelivery.message)
  })

  it('requeues the redelivery when the run it waited for failed', async () => {
    const gate = deferred()
    const callback = await subscribe(async () => {
      await gate.promise
      throw new Error('handler failed')
    })
    const first = channels.at(-1)!
    const body = { id: 'tag-upload', params: { cid: 'c' } }
    const original = deliver(first, body)

    brokerClosesChannel(first)
    const second = await waitForReplacement(first)
    const redelivery = deliver(second, body, true)
    gate.resolve()
    await Promise.all([original.settled, redelivery.settled])

    expect(callback).toHaveBeenCalledTimes(1)
    expect(second.nack).toHaveBeenCalledWith(redelivery.message, false, true)
  })

  it('still runs a redelivered message it has no record of', async () => {
    const callback = await subscribe(async () => undefined)
    const channel = channels.at(-1)!

    // Requeued after some other consumer died, for instance.
    const { message, settled } = deliver(
      channel,
      { id: 'tag-upload', params: { cid: 'd' } },
      true,
    )
    await settled

    expect(callback).toHaveBeenCalledTimes(1)
    expect(channel.ack).toHaveBeenCalledWith(message)
  })
})
