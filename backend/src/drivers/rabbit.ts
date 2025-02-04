import { Channel, Connection, connect } from 'amqplib'
import { config } from '../config.js'

const queue = 'task-manager'

let connection: Connection | null = null
let channel: Channel | null = null

const init = async () => {
  if (!connection) {
    connection = await connect(config.rabbitmq.url)
    connection.on('close', () => {
      connection = null
      channel = null
    })
  }
  if (!channel) {
    channel = await connection.createChannel()
    await channel.assertQueue(queue)
  }
  return channel
}

const getConnection = async () => {
  if (!channel) {
    await init()
  }
  return channel!
}

const publish = async (message: object) => {
  const channel = await getConnection()
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
  if (channel) {
    await channel.close()
    channel = null
  }
  if (connection) {
    await connection.close()
    connection = null
  }
}

export const Rabbit = {
  init,
  publish,
  subscribe,
  close,
}
