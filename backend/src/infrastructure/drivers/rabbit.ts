import { Channel, ConsumeMessage, connect } from 'amqplib'
import { config } from '../../config.js'
import { createLogger } from './logger.js'

const logger = createLogger('drivers:rabbit')

const queues = ['task-manager', 'download-manager']

let channelPromise: Promise<Channel> | null = null

const getChannel = async () => {
  if (!channelPromise) {
    channelPromise = connect(config.rabbitmq.url).then((connection) =>
      connection.createChannel().then((channel) => {
        queues.forEach((q) => channel.assertQueue(q))
        channel.prefetch(config.rabbitmq.prefetch)
        return channel
      }),
    )
  }

  return channelPromise
}

const publish = async (queue: string, message: object) => {
  const channel = await getChannel()
  channel.assertQueue(queue)
  channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)))
}

const subscribe = async (
  queue: string,
  callback: (message: Record<string, unknown>) => Promise<unknown>,
) => {
  const channel = await getChannel()

  const consume = await channel.consume(
    queue,
    async (message: ConsumeMessage | null): Promise<void> => {
      if (message) {
        try {
          const payload = JSON.parse(message.content.toString())
          logger.debug('Received message from %s', queue)
          await callback(payload)
          logger.debug('Message processed successfully for %s', queue)
          channel.ack(message)
        } catch (error) {
          logger.error('Error processing message from %s', queue, error)
          channel.nack(message, false, true)
        }
      } else {
        logger.warn('No message received from %s', queue)
      }
    },
  )

  return () => {
    channel.cancel(consume.consumerTag)
  }
}

const close = async () => {
  const channel = await channelPromise
  channelPromise = null
  await channel?.close()
}

export const Rabbit = {
  getChannel,
  publish,
  subscribe,
  close,
}
