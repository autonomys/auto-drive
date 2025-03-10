import { v4 } from 'uuid'
import { InteractionType } from '@auto-drive/models'
import { interactionsRepository } from '../../repositories/objects/interactions.js'
import { Metric, sendMetricToVictoria } from '../../drivers/vmetrics.js'
import { config } from '../../config.js'

const createMetric = (type: InteractionType, size: bigint): Metric => {
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
  sendMetricToVictoria(createMetric(type, size))
  await interactionsRepository.createInteraction(
    v4(),
    subscriptionId,
    type,
    size,
  )
}

export const InteractionsUseCases = {
  createInteraction,
}
