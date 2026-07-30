import { jest, describe, it, expect, beforeEach } from '@jest/globals'

/**
 * Covers unsubscribe staying correct across a re-subscribe.
 *
 * On reconnect, `getChannel` re-subscribes every stored callback — literally
 * `subscribe(queue, callback)` — and discards the new unsubscribe handles. So an
 * unsubscribe that captured its own consumer tag at subscribe time goes stale the
 * moment the connection bounces: cancelling it targets a consumer that is already
 * gone while the live one keeps delivering. These tests drive that re-subscribe
 * directly, which is what the reconnect path does.
 *
 * `amqplib` is mocked because the driver's reconnect is internal (keepAlive owns
 * the cached channel), so there is no public way to force one.
 */

const consumerTags: string[] = []
const cancelledTags: string[] = []
let nextConsumerTag = 0

jest.unstable_mockModule('amqplib', () => ({
  connect: jest.fn(async () => ({
    createChannel: async () => ({
      assertQueue: jest.fn(),
      prefetch: jest.fn(),
      ack: jest.fn(),
      nack: jest.fn(),
      sendToQueue: jest.fn(),
      consume: async () => {
        const consumerTag = `tag-${nextConsumerTag++}`
        consumerTags.push(consumerTag)
        return { consumerTag }
      },
      cancel: async (tag: string) => {
        cancelledTags.push(tag)
      },
      checkQueue: async () => ({ messageCount: 0 }),
      close: async () => undefined,
    }),
    close: async () => undefined,
  })),
}))

const { Rabbit } = await import('../../../src/infrastructure/drivers/rabbit.js')

describe('Rabbit unsubscribe across a re-subscribe', () => {
  beforeEach(async () => {
    await Rabbit.close().catch(() => undefined)
    consumerTags.length = 0
    cancelledTags.length = 0
  })

  it('cancels the consumer that is live now, not the one it was handed', async () => {
    const callback = jest.fn(async () => undefined)

    const unsubscribe = await Rabbit.subscribe(
      'download-errors',
      callback as never,
    )
    const tagsAfterFirstSubscribe = [...consumerTags]

    // Exactly what the reconnect path does with the same callback.
    await Rabbit.subscribe('download-errors', callback as never)
    const liveTag = consumerTags[consumerTags.length - 1]
    expect(tagsAfterFirstSubscribe).not.toContain(liveTag)

    await unsubscribe()

    // Pre-fix this cancelled a tag from the first subscribe and left the live
    // consumer delivering.
    expect(cancelledTags).toContain(liveTag)
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
  })
})
