import { Channel, connect } from 'amqplib'
import { config } from '../config.js'

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
  callback: (message: object) => Promise<unknown>,
) => {
  const channel = await getChannel()

  const consume = await channel.consume(queue, async (message) => {
    if (message) {
      try {
        await callback(JSON.parse(message.content.toString()))
        channel.ack(message)
      } catch (error) {
        console.error('Error processing message', error)
        channel.nack(message, false, true)
      }
    } else {
      console.error('No message received')
    }
  })

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
