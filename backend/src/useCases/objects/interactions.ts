import { v4 } from 'uuid'
import { InteractionType } from '@auto-drive/models'
import { interactionsRepository } from '../../repositories/objects/interactions.js'
import { Metric, sendMetricToVictoria } from '../../drivers/vmetrics.js'
import { config } from '../../config.js'
import { createLogger } from '../../drivers/logger.js'

const logger = createLogger('useCases:objects:interactions')

const createMetric = (type: InteractionType, size: bigint): Metric => {
  logger.trace('Creating interaction metric (type=%s, size=%d)', type, size)
  const tags = {
    chain: config.monitoring.metricEnvironmentTag,
    type,
  }

  const tag = Object.entries(tags)
    .map(([key, value]) => `${key}=${value}`)
    .join(',')

  return {
    measurement: 'auto_drive_interactions',
    tag,
    fields: {
      size,
    },
  }
}

const createInteraction = async (
  subscriptionId: string,
  type: InteractionType,
  size: bigint,
): Promise<void> => {
  logger.debug(
    'Creating new interaction (subscriptionId=%s, type=%s, size=%d)',
    subscriptionId,
    type,
    size,
  )

  try {
    const metric = createMetric(type, size)
    logger.trace(
      'Sending metric to Victoria (measurement=%s, tag=%s)',
      metric.measurement,
      metric.tag,
    )
    sendMetricToVictoria(metric)

    const interactionId = v4()
    await interactionsRepository.createInteraction(
      interactionId,
      subscriptionId,
      type,
      size,
    )
    logger.info(
      'Interaction created successfully (id=%s, subscriptionId=%s, type=%s)',
      interactionId,
      subscriptionId,
      type,
    )
  } catch (error) {
    logger.error(
      'Failed to create interaction (subscriptionId=%s, type=%s): %s',
      subscriptionId,
      type,
      error,
    )
    throw error
  }
}

export const InteractionsUseCases = {
  createInteraction,
}
