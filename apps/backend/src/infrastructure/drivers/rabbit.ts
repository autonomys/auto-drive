import { Channel, ConsumeMessage, connect } from 'amqplib'
import { config } from '../../config.js'
import { createLogger } from './logger.js'
import { withBackingOffRetries } from '../../shared/utils/retries.js'

type SubscriptionCallback = (
  message: Record<string, unknown>,
) => Promise<unknown>

const logger = createLogger('drivers:rabbit')

const KEEP_ALIVE_INTERVAL = 60_000
const queues = ['task-manager', 'download-manager']
const subscriptions: Record<string, SubscriptionCallback[]> = {}

let channelPromise: Promise<Channel> | null = null
let keepAliveInterval: NodeJS.Timeout | null = null

const getChannel = async () => {
  if (!channelPromise) {
    channelPromise = connect(config.rabbitmq.url).then((connection) =>
      connection.createChannel().then((channel) => {
        queues.forEach((q) => channel.assertQueue(q))
        channel.prefetch(config.rabbitmq.prefetch)
        return channel
      }),
    )
    channelPromise.then(() => {
      for (const queue in subscriptions) {
        const queueSubscriptions = subscriptions[queue]
        subscriptions[queue] = []
        for (const callback of queueSubscriptions) {
          subscribe(queue, callback)
        }
      }
    })

    keepAliveInterval = setInterval(keepAlive, KEEP_ALIVE_INTERVAL)
  }

  return channelPromise
}

const publish = async (queue: string, message: object) => {
  return withBackingOffRetries(
    async () => {
      const channel = await getChannel()
      channel.assertQueue(queue)
      channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)))
    },
    { maxRetries: 3, startingDelay: 1000 },
  )
}

const keepAlive = async () => {
  const channel = await getChannel()
  try {
    // Passive check against an existing queue to keep the connection active
    await channel.checkQueue(queues[0])
    logger.debug('RabbitMQ keepalive successful')
  } catch {
    logger.warn('RabbitMQ keepalive failed, resetting channel')
    try {
      await channel.close()
    } catch {
      // ignore errors while closing a stale channel
    }
    channelPromise = null
    // attempt immediate reconnect so next operations don't stall
    try {
      await getChannel()
    } catch (reconnectError) {
      logger.error(
        'RabbitMQ reconnect after keepalive failure failed',
        reconnectError,
      )
    }
  }
}

const subscribe = async (
  queue: string,
  callback: (message: Record<string, unknown>) => Promise<unknown>,
) => {
  if (!subscriptions[queue]) {
    subscriptions[queue] = [] as SubscriptionCallback[]
  }
  subscriptions[queue].push(callback)

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
    subscriptions[queue] = subscriptions[queue].filter((c) => c !== callback)
  }
}

const close = async () => {
  const channel = await channelPromise
  channelPromise = null
  for (const queue in subscriptions) {
    subscriptions[queue] = []
  }

  if (keepAliveInterval) {
    clearInterval(keepAliveInterval)
  }
  await channel?.close()
}

export const Rabbit = {
  getChannel,
  publish,
  subscribe,
  close,
}
