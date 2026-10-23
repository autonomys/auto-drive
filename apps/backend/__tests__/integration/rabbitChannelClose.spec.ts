import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { Channel, ChannelModel, ConsumeMessage, connect } from 'amqplib'
import { v4 } from 'uuid'
import { Rabbit } from '../../src/infrastructure/drivers/rabbit.js'

jest.setTimeout(60_000)

const QUEUE = 'publish-errors'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (predicate: () => Promise<boolean>, timeout = 20_000) => {
  for (let waited = 0; waited < timeout; waited += 100) {
    if (await predicate()) return true
    await tick(100)
  }
  return predicate()
}

/**
 * Real amqplib against the real broker. The broker's delivery acknowledgement
 * timeout cannot be provoked in a test (30 minutes, checked on a coarse tick),
 * so the channel is closed by acking a delivery tag the broker never issued:
 * that also ends in a server-sent Channel.Close with 406 PRECONDITION_FAILED,
 * which is the path the timeout takes through amqplib.
 */
describe('Rabbit when the broker closes the consuming channel', () => {
  const crashes: unknown[] = []
  const record = (reason: unknown) => crashes.push(reason)
  let inspector: ChannelModel
  let inspectorChannel: Channel

  beforeAll(async () => {
    process.on('uncaughtException', record)
    process.on('unhandledRejection', record)
    inspector = await connect(process.env.RABBITMQ_URL!)
    inspectorChannel = await inspector.createChannel()
    await inspectorChannel.assertQueue(QUEUE)
    await inspectorChannel.purgeQueue(QUEUE)
  })

  afterAll(async () => {
    await Rabbit.close().catch(() => undefined)
    await inspector.close()
    process.off('uncaughtException', record)
    process.off('unhandledRejection', record)
  })

  it('keeps the in-flight task running once and acks its redelivery when it ends', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const handler = jest.fn(async () => gate)

    await Rabbit.subscribe(QUEUE, handler)
    await Rabbit.publish(QUEUE, { id: 'probe', nonce: v4() })
    expect(await waitFor(async () => handler.mock.calls.length === 1)).toBe(
      true,
    )

    const closed = await Rabbit.getChannel()
    closed.ack({
      fields: { deliveryTag: 999_999 },
    } as unknown as ConsumeMessage)

    // The broker requeued the unacked message when it closed the channel, and
    // has now handed it to the consumer on the replacement channel: nothing is
    // ready on the queue, and a consumer is attached again.
    expect(
      await waitFor(async () => {
        const current = await Rabbit.getChannel().catch(() => closed)
        if (current === closed) return false
        const { messageCount, consumerCount } =
          await inspectorChannel.checkQueue(QUEUE)
        return messageCount === 0 && consumerCount === 1
      }),
    ).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)

    release()
    await tick(500)

    // Closing the driver hands any delivery it still holds back to the queue,
    // so an empty queue afterwards means the redelivery really was acked.
    await Rabbit.close()
    const { messageCount } = await inspectorChannel.checkQueue(QUEUE)
    expect(messageCount).toBe(0)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(crashes).toHaveLength(0)
  })
})
