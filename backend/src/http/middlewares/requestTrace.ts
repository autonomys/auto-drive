import { RequestHandler } from 'express'
import { Metric, sendMetricToVictoria } from '../../drivers/vmetrics.js'
import { config } from '../../config.js'
import { logger } from '../../drivers/logger.js'

export const requestTrace: RequestHandler = (req, res, next) => {
  console.log('Request trace', {
    path: req.route?.path,
    method: req.method,
    provider: req.headers['x-auth-provider'],
  })
  const path = req.route?.path

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
}
