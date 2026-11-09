import { config } from '../../config.js'
import { createLogger } from './logger.js'

const logger = createLogger('drivers:metrics')

export interface Metric {
  measurement: string
  tags: Record<string, string>
  // VictoriaMetrics stores a string field as a constant 0, so only numbers are
  // worth sending.
  fields: Record<string, number | bigint>
  timestamp?: number
}

// Line protocol has no escape for a line break, so it becomes a space.
const escape = (value: string): string =>
  value.replace(/[\r\n]+/g, ' ').replace(/[\\, =]/g, '\\$&')

export const toLineProtocol = (metric: Metric): string => {
  const tags = Object.entries(metric.tags)
    .map(([key, value]) => [key, String(value)])
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `,${escape(key)}=${escape(value)}`)
    .join('')

  const fields = Object.entries(metric.fields)
    .map(([key, value]) => `${escape(key)}=${value}`)
    .join(',')

  return `${escape(metric.measurement)}${tags} ${fields}`
}

export const sendMetricToVictoria = async (metric: Metric): Promise<void> => {
  try {
    const data = toLineProtocol(metric)

    const basicAuthToken = Buffer.from(
      `${config.monitoring.auth.username}:${config.monitoring.auth.password}`,
    ).toString('base64')

    if (!config.monitoring.victoriaEndpoint) {
      if (config.monitoring.active) {
        logger.warn('Victoria endpoint is not set')
      }
      return
    }

    const response = await fetch(config.monitoring.victoriaEndpoint, {
      method: 'POST',
      body: data,
      headers: {
        Authorization: `Basic ${basicAuthToken}`,
      },
    })
    if (!response.ok) {
      throw new Error(
        `Failed to send metric to Victoria: ${response.statusText}: ${await response.text()}`,
      )
    } else {
      logger.debug('Metric %s sent to Victoria', metric.measurement)
    }
  } catch (error) {
    logger.error('Failed to send metric to Victoria', error)
  }
}
