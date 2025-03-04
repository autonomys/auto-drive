import { config } from '../config.js'

export interface Metric {
  measurement: string
  tag: string
  fields: Record<string, string | number | bigint>
  timestamp?: number
}

export const sendMetricToVictoria = async (metric: Metric): Promise<void> => {
  const values = Object.entries(metric.fields).map(
    ([key, value]) => `${key}=${value}`,
  )
  const data = `${metric.measurement},${metric.tag} ${values.join(',')}`

  const basicAuthToken = Buffer.from(
    `${config.monitoring.auth.username}:${config.monitoring.auth.password}`,
  ).toString('base64')

  if (!config.monitoring.victoriaEndpoint) {
    console.error('Victoria endpoint is not set')
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
    throw new Error(`Failed to send metric to Victoria: ${response.statusText}`)
  }
}
