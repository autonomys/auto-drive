import { Channel, ConsumeMessage, connect } from 'amqplib'
import { config } from '../../config.js'
import { createLogger } from './logger.js'
import { withBackingOffRetries } from '../../shared/utils/retries.js'

type SubscriptionCallback = (
  message: Record<string, unknown>,
) => Promise<unknown>

export type Queue = (typeof queues)[number]

const logger = createLogger('drivers:rabbit')

// Error queues are listed here so they are asserted at channel setup and are
// valid `subscribe`/`getMessageCount` targets. They were previously created
// implicitly by `publish` alone, which left them unsubscribable — and so they
// accumulated permanently failed tasks that nobody ever read.
const queues = [
  'task-manager',
  'download-manager',
  'publish-manager',
  'frontend-errors',
  'download-errors',
  'publish-errors',
] as const
const subscriptions: Partial<Record<Queue, SubscriptionCallback[]>> = {}

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
      for (const queue of queues) {
        const queueSubscriptions = subscriptions[queue] ?? []
        subscriptions[queue] = []
        for (const callback of queueSubscriptions) {
          subscribe(queue, callback)
        }
      }
    })
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval)
      keepAliveInterval = null
    }
    keepAliveInterval = setInterval(
      keepAlive,
      config.rabbitmq.keepAliveInterval,
    )
  }

  return channelPromise
}

const publish = async (queue: string, message: object) => {
  return withBackingOffRetries(
    async () => {
      const channel = await getChannel()
      channel.assertQueue(queue)
      channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        persistent: true,
      })
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
  queue: Queue,
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

  // Awaits the cancel rather than firing and forgetting it: callers that stop a
  // consumer in order to quiesce before doing something else (see
  // EventRouter.stopTaskErrors) need "stopped" to actually mean stopped by the
  // time this resolves. Note that cancelling halts *new* deliveries — messages
  // already handed to the client may still be in their callback afterwards.
  return async () => {
    try {
      await channel.cancel(consume.consumerTag)
    } finally {
      subscriptions[queue] =
        subscriptions[queue]?.filter((c) => c !== callback) ?? []
    }
  }
}

// Typed to the known `Queue` union rather than `string`: checkQueue against a
// non-existent queue returns a 404 that tears down the shared channel (breaking
// every concurrent publish/consume until keepAlive rebuilds it), so a typo'd
// queue name must fail at compile time, not at runtime.
const getMessageCount = async (queue: Queue): Promise<number> => {
  const channel = await getChannel()
  const result = await channel.checkQueue(queue)
  return result.messageCount
}

const close = async () => {
  const channel = await channelPromise
  channelPromise = null
  for (const queue of queues) {
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
  getMessageCount,
  close,
}
