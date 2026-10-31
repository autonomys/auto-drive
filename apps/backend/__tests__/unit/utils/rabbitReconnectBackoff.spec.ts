import { jest, describe, it, expect, afterAll } from '@jest/globals'
import { EventEmitter } from 'events'

/**
 * Covers how fast the driver reopens a channel the broker closed.
 *
 * Kept apart from rabbitReconnect.spec.ts because that file shortens the
 * keepalive to 20ms, and the keepalive reconnects by itself: here only the
 * reconnect timer may reopen a channel, so its schedule is what gets measured.
 * The first delay is shortened instead, so the backoff runs in milliseconds.
 */

process.env.RABBITMQ_KEEP_ALIVE_INTERVAL = '600000'
process.env.RABBITMQ_RECONNECT_DELAY_MS = '20'

interface FakeChannel extends EventEmitter {
  closed: boolean
}

const channels: FakeChannel[] = []
let connects = 0
let failSetup = false

/** What amqplib does on a server-initiated Channel.Close: 'error', then 'close'. */
const brokerCloses = (channel: FakeChannel) => {
  if (channel.closed) return
  channel.closed = true
  channel.emit(
    'error',
    Object.assign(
      new Error(
        'Channel closed by server: 406 (PRECONDITION-FAILED) with message "PRECONDITION_FAILED - inequivalent arg x-queue-type for queue task-manager"',
      ),
      { code: 406 },
    ),
  )
  channel.emit('close')
}

jest.unstable_mockModule('amqplib', () => ({
  connect: jest.fn(async () => {
    connects++
    return Object.assign(new EventEmitter(), {
      createChannel: async () => {
        const channel: FakeChannel = Object.assign(new EventEmitter(), {
          closed: false,
          // A queue redeclared with different arguments: the broker answers
          // the declaration by closing the channel.
          assertQueue: async () => {
            if (failSetup) {
              brokerCloses(channel)
              throw new Error('Channel closed')
            }
          },
          prefetch: async () => undefined,
          consume: async () => ({ consumerTag: `tag-${channels.length}` }),
          cancel: async () => undefined,
          checkQueue: async () => ({ messageCount: 0 }),
          close: async () => {
            channel.closed = true
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

const { Rabbit } = await import('../../../src/infrastructure/drivers/rabbit.js')

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (predicate: () => boolean, timeout = 5000) => {
  for (let waited = 0; waited < timeout && !predicate(); waited += 10) {
    await tick(10)
  }
  return predicate()
}

describe('Rabbit reconnect backoff', () => {
  afterAll(async () => {
    await Rabbit.close().catch(() => undefined)
  })

  it('backs off while every reopened channel is closed during setup, and resets once one opens', async () => {
    await Rabbit.subscribe(
      'task-manager',
      jest.fn(async () => undefined),
    )
    await tick(20)

    failSetup = true
    const before = connects
    brokerCloses(channels.at(-1)!)
    await tick(700)

    // A fixed 20ms delay would have reconnected about 35 times by now; doubling
    // from 20ms gives attempts at 20, 60, 140, 300 and 620ms.
    const attempts = connects - before
    expect(attempts).toBeGreaterThanOrEqual(3)
    expect(attempts).toBeLessThanOrEqual(6)

    failSetup = false
    const opened = channels.length
    expect(
      await waitFor(() => channels.length > opened && !channels.at(-1)!.closed),
    ).toBe(true)
    await tick(20)

    // A channel that opened resets the delay, so the next close is followed by
    // a prompt reconnect rather than the long delay the failures built up.
    const healthy = channels.at(-1)!
    const reopenedAt = Date.now()
    brokerCloses(healthy)
    expect(
      await waitFor(
        () => channels.at(-1) !== healthy && !channels.at(-1)!.closed,
        1000,
      ),
    ).toBe(true)
    expect(Date.now() - reopenedAt).toBeLessThan(300)
  }, 15000)
})
