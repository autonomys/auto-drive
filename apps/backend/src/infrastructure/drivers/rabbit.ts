import { Channel, ChannelModel, ConsumeMessage, connect } from 'amqplib'
import { config } from '../../config.js'
import { createLogger } from './logger.js'
import { withBackingOffRetries } from '../../shared/utils/retries.js'

type SubscriptionCallback = (
  message: Record<string, unknown>,
) => Promise<unknown>

type Queue = (typeof queues)[number]

const logger = createLogger('drivers:rabbit')

const queues = ['task-manager', 'download-manager'] as const
const subscriptions: Partial<Record<Queue, SubscriptionCallback[]>> = {}

// One channel per queue so prefetch / QoS can be tuned independently.
// `task-manager` processes memory-heavy `publish-nodes` jobs and should
// run at a lower concurrency than `download-manager`.
const channelPromises: Partial<Record<Queue, Promise<Channel>>> = {}
let connectionPromise: Promise<ChannelModel> | null = null
let keepAliveInterval: NodeJS.Timeout | null = null

const prefetchFor = (queue: Queue): number => {
  const override = config.rabbitmq.queuePrefetch?.[queue]
  return typeof override === 'number' && override > 0
    ? override
    : config.rabbitmq.prefetch
}

const getConnection = async (): Promise<ChannelModel> => {
  if (!connectionPromise) {
    connectionPromise = connect(config.rabbitmq.url)
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval)
      keepAliveInterval = null
    }
    keepAliveInterval = setInterval(
      keepAlive,
      config.rabbitmq.keepAliveInterval,
    )
  }
  return connectionPromise
}

const getChannel = async (queue: Queue): Promise<Channel> => {
  if (!channelPromises[queue]) {
    channelPromises[queue] = (async () => {
      const connection = await getConnection()
      const channel = await connection.createChannel()
      await channel.assertQueue(queue)
      await channel.prefetch(prefetchFor(queue))
      logger.info(
        'RabbitMQ channel ready for %s (prefetch=%d)',
        queue,
        prefetchFor(queue),
      )
      return channel
    })()
    channelPromises[queue]!.then(() => {
      const queueSubscriptions = subscriptions[queue] ?? []
      subscriptions[queue] = []
      for (const callback of queueSubscriptions) {
        subscribe(queue, callback)
      }
    }).catch((error) => {
      logger.error('Failed to initialise channel for %s', queue, error)
    })
  }
  return channelPromises[queue]!
}

const isKnownQueue = (queue: string): queue is Queue =>
  (queues as readonly string[]).includes(queue)

const publish = async (queue: string, message: object) => {
  if (!isKnownQueue(queue)) {
    throw new Error(`Unknown RabbitMQ queue: ${queue}`)
  }
  return withBackingOffRetries(
    async () => {
      const channel = await getChannel(queue)
      channel.assertQueue(queue)
      channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        persistent: true,
      })
    },
    { maxRetries: 3, startingDelay: 1000 },
  )
}

const keepAlive = async () => {
  // Use the task-manager channel (always present in this service) for a
  // cheap passive check to keep the connection warm.
  try {
    const channel = await getChannel('task-manager')
    await channel.checkQueue('task-manager')
    logger.debug('RabbitMQ keepalive successful')
  } catch {
    logger.warn('RabbitMQ keepalive failed, resetting connection and channels')
    await resetConnection()
  }
}

const resetConnection = async () => {
  for (const queue of queues) {
    const existing = channelPromises[queue]
    channelPromises[queue] = undefined
    if (existing) {
      try {
        const channel = await existing
        await channel.close()
      } catch {
        // ignore errors while closing stale channel
      }
    }
  }
  const existingConnection = connectionPromise
  connectionPromise = null
  if (existingConnection) {
    try {
      const connection = await existingConnection
      await connection.close()
    } catch {
      // ignore errors while closing stale connection
    }
  }
  // attempt immediate reconnect so next operations don't stall
  try {
    await getConnection()
  } catch (reconnectError) {
    logger.error(
      'RabbitMQ reconnect after keepalive failure failed',
      reconnectError,
    )
  }
}

const subscribe = async (
  queue: Queue,
  callback: (message: Record<string, unknown>) => Promise<unknown>,
) => {
  if (!subscriptions[queue]) {
    subscriptions[queue] = [] as SubscriptionCallback[]
  }
  subscriptions[queue].push(callback)

  const channel = await getChannel(queue)

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
    subscriptions[queue] =
      subscriptions[queue]?.filter((c) => c !== callback) ?? []
  }
}

const close = async () => {
  for (const queue of queues) {
    const channelPromise = channelPromises[queue]
    channelPromises[queue] = undefined
    subscriptions[queue] = []
    if (channelPromise) {
      try {
        const channel = await channelPromise
        await channel.close()
      } catch {
        // ignore errors while closing channel during shutdown
      }
    }
  }

  if (keepAliveInterval) {
    clearInterval(keepAliveInterval)
    keepAliveInterval = null
  }

  const existingConnection = connectionPromise
  connectionPromise = null
  if (existingConnection) {
    try {
      const connection = await existingConnection
      await connection.close()
    } catch {
      // ignore errors while closing connection during shutdown
    }
  }
}

export const Rabbit = {
  getChannel,
  publish,
  subscribe,
  close,
}
