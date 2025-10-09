import { RequestHandler } from 'express'
import {
  Metric,
  sendMetricToVictoria,
} from '../../infrastructure/drivers/vmetrics.js'
import { config } from '../../config.js'

export const requestTrace: RequestHandler = (req, res) => {
  const path = req.route?.path

  const rawPath = req.path

  const method = req.method
  const provider =
    typeof req.headers['x-auth-provider'] === 'string'
      ? req.headers['x-auth-provider']
      : 'unknown'

  const tags = {
    chain: config.monitoring.metricEnvironmentTag,
    method,
    path,
    provider,
  }

  const metric: Metric = {
    measurement: 'auto_drive_api_request',
    tags,
    fields: {
      status: res.statusCode,
      method,
      path,
      provider,
      rawPath,
    },
  }

  sendMetricToVictoria(metric)
}
