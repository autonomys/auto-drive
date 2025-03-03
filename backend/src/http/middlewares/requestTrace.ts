import { RequestHandler } from 'express'
import { Metric, sendMetricToVictoria } from '../../drivers/vmetrics'
import { config } from '../../config'

export const requestTrace: RequestHandler = (req, res, next) => {
  const path = req.route?.path

  if (!path) {
    return next()
  }

  res.once('finish', () => {
    const method = req.method
    const provider =
      typeof req.headers['x-auth-provider'] === 'string'
        ? req.headers['x-auth-provider']
        : 'unknown'

    const metric: Metric = {
      measurement: 'auto_drive_api_request',
      tag: config.monitoring.metricEnvironmentTag,
      fields: {
        status: res.statusCode,
        method,
        path,
        provider,
      },
    }

    sendMetricToVictoria(metric).catch(console.error)
  })

  next()
}
