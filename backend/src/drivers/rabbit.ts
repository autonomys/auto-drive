import { Channel, connect } from 'amqplib'
import { config } from '../config.js'

const queue = 'task-manager'

const init = async () => {
  const connection = await connect(config.rabbitmq.url)
  const channel = await connection.createChannel()
  await channel.assertQueue('task-manager')

  return channel
}

let channel: Promise<Channel> | null = null

const getConnection = async () => {
  if (!channel) {
    channel = init()
  }
  return channel
}

const publish = async (message: object) => {
  const channel = await getConnection()

  await channel.assertQueue(queue)
  channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)))
}

const subscribe = async (callback: (message: object) => Promise<unknown>) => {
  const channel = await getConnection()

  const consume = await channel.consume(queue, async (message) => {
    if (message) {
      try {
        await callback(JSON.parse(message.content.toString()))
      } catch (error) {
        console.error('Error processing message', error)
      }
      channel.ack(message)
    } else {
      console.error('No message received')
    }
  })

  return () => {
    channel.cancel(consume.consumerTag)
  }
}

const close = async () => {
  const channelInstance = await channel
  channel = null
  await channelInstance?.connection?.close()
}

export const Rabbit = {
  init,
  publish,
  subscribe,
  close,
}
