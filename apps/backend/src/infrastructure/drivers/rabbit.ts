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

interface ActiveConsumer {
  channel: Channel
  // Held as a promise, and stored in the same tick as the `consume` call that
  // produces it, so the entry doubles as an in-flight reservation: a second
  // caller arriving while the first `consume` is still on the wire sees it and
  // reuses it instead of opening a rival consumer.
  consumerTag: Promise<string>
}

/**
 * The consumer currently serving each callback, per queue.
 *
 * A reconnect re-subscribes every stored callback on a fresh channel and discards
 * the new unsubscribe handles (see `getChannel`), so a handle that closed over its
 * own channel and consumer tag went stale the moment the connection bounced:
 * cancelling it targeted a dead consumer on a closed channel while the live one
 * kept delivering. Unsubscribing therefore looks the consumer up here, at call
 * time, rather than capturing it at subscribe time.
 *
 * The map is also what keeps consumers unique per (queue, callback, channel) —
 * see `ensureConsumer`.
 */
const activeConsumers: Partial<
  Record<Queue, Map<SubscriptionCallback, ActiveConsumer>>
> = {}

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

/**
 * Starts consuming `queue` with `callback`, or reuses the consumer already doing
 * so on this channel.
 *
 * Two paths race to establish the same consumer: the `subscribe` call itself,
 * and the re-subscribe loop `getChannel` runs once its channel resolves. On the
 * very first subscribe both fire — the callback is registered in `subscriptions`
 * before `getChannel` is even called, so the loop that is meant to restore
 * consumers after a reconnect also picks up the subscribe that is still in
 * flight. Each then called `consume` and the later one overwrote the other's
 * entry in `activeConsumers`, leaving a second live consumer that nothing held a
 * tag for: `unsubscribe`/`stopTaskErrors` cancelled one, the orphan kept
 * delivering, and on shutdown its messages landed in a batch created after the
 * final flush had already run.
 *
 * Reserving the entry synchronously — before awaiting the `consume` — closes
 * that window regardless of which path gets there first.
 */
const ensureConsumer = (
  queue: Queue,
  callback: SubscriptionCallback,
  channel: Channel,
): ActiveConsumer => {
  let consumers = activeConsumers[queue]
  if (!consumers) {
    consumers = new Map()
    activeConsumers[queue] = consumers
  }

  const existing = consumers.get(callback)
  if (existing) {
    if (existing.channel === channel) {
      return existing
    }
    // A different channel means a reconnect replaced the one this consumer lived
    // on. That channel is normally closed already (which kills its consumers),
    // but a close that failed would leave the old consumer delivering into a
    // callback nobody can stop, so cancel it best-effort before dropping it.
    existing.consumerTag
      .then((tag) => existing.channel.cancel(tag))
      .catch((error) => {
        logger.debug(
          'Could not cancel superseded consumer on %s: %s',
          queue,
          error,
        )
      })
  }

  const consumerTag = channel
    .consume(queue, async (message: ConsumeMessage | null): Promise<void> => {
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
    })
    .then((consume) => consume.consumerTag)

  const consumer: ActiveConsumer = { channel, consumerTag }
  consumers.set(callback, consumer)

  // A failed `consume` must not leave its reservation behind, or a later
  // subscribe on this same channel would hand back a consumer that never
  // existed. Also marks the rejection handled — `subscribe` re-raises it to its
  // own caller.
  consumerTag.catch(() => {
    if (consumers.get(callback) === consumer) {
      consumers.delete(callback)
    }
  })

  return consumer
}

const subscribe = async (
  queue: Queue,
  callback: (message: Record<string, unknown>) => Promise<unknown>,
) => {
  if (!subscriptions[queue]) {
    subscriptions[queue] = [] as SubscriptionCallback[]
  }
  // Guarded against duplicates so a reconnect cannot register the same callback
  // twice and start delivering each message to it more than once.
  if (!subscriptions[queue].includes(callback)) {
    subscriptions[queue].push(callback)
  }

  const channel = await getChannel()

  // Awaited so this resolves only once the broker has the consumer, as before.
  await ensureConsumer(queue, callback, channel).consumerTag

  // Awaits the cancel rather than firing and forgetting it: callers that stop a
  // consumer in order to quiesce before doing something else (see
  // EventRouter.stopTaskErrors) need "stopped" to actually mean stopped by the
  // time this resolves. Note that cancelling halts *new* deliveries — messages
  // already handed to the client may still be in their callback afterwards.
  return async () => {
    // Deregister before cancelling. A reconnect re-subscribes whatever is in
    // `subscriptions`, so leaving the callback there while awaiting the cancel
    // gives a reconnect landing mid-cancel the chance to resurrect the consumer.
    subscriptions[queue] =
      subscriptions[queue]?.filter((c) => c !== callback) ?? []

    // Looked up now rather than captured above, so this cancels whichever
    // consumer is live — including one created by a reconnect after this handle
    // was handed out.
    const active = activeConsumers[queue]?.get(callback)
    activeConsumers[queue]?.delete(callback)
    if (!active) {
      return
    }

    try {
      await active.channel.cancel(await active.consumerTag)
    } catch (error) {
      // A cancel against an already-closed channel is moot: that consumer is
      // gone either way, which is what the caller wanted.
      logger.warn('Failed to cancel consumer on %s: %s', queue, error)
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
    activeConsumers[queue]?.clear()
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
