import { v4 } from 'uuid'
import { InteractionSource, InteractionType } from '@auto-drive/models'
import { interactionsRepository } from '../../infrastructure/repositories/objects/interactions.js'
import {
  Metric,
  sendMetricToVictoria,
} from '../../infrastructure/drivers/vmetrics.js'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('useCases:objects:interactions')

const createMetric = (type: InteractionType, size: bigint): Metric => {
  logger.trace('Creating interaction metric (type=%s, size=%d)', type, size)
  const tags = {
    chain: config.monitoring.metricEnvironmentTag,
    type,
  }

  return {
    measurement: 'auto_drive_interactions',
    tags,
    fields: {
      size,
    },
  }
}

const createInteraction = async (
  accountId: string,
  type: InteractionType,
  size: bigint,
  source: InteractionSource,
  cid?: string,
): Promise<void> => {
  logger.debug(
    'Creating new interaction (accountId=%s, type=%s, size=%d, source=%s, cid=%s)',
    accountId,
    type,
    size,
    source,
    cid,
  )

  try {
    const metric = createMetric(type, size)
    logger.trace(
      'Sending metric to Victoria (measurement=%s, tag=%s)',
      metric.measurement,
      JSON.stringify(metric.tags),
    )
    sendMetricToVictoria(metric)

    const interactionId = v4()
    await interactionsRepository.createInteraction(
      interactionId,
      accountId,
      type,
      size,
      source,
      cid,
    )
    logger.info(
      'Interaction created successfully (id=%s, accountId=%s, type=%s, source=%s, cid=%s)',
      interactionId,
      accountId,
      type,
      source,
      cid,
    )
  } catch (error) {
    logger.error(
      'Failed to create interaction (accountId=%s, type=%s): %s',
      accountId,
      type,
      error,
    )
    throw error
  }
}

export const InteractionsUseCases = {
  createInteraction,
}
