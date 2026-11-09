import { RequestHandler } from 'express'
import {
  Metric,
  sendMetricToVictoria,
} from '../../infrastructure/drivers/vmetrics.js'
import { config } from '../../config.js'

// The providers apps/auth accepts.
const KNOWN_PROVIDERS = new Set([
  'apikey',
  'custom-jwt',
  'discord',
  'github',
  'google',
  'web3-wallet',
])

export const toProviderTag = (header: string | string[] | undefined) => {
  if (typeof header !== 'string') return 'unknown'
  return KNOWN_PROVIDERS.has(header) ? header : 'other'
}

export const requestTrace: RequestHandler = (req, res) => {
  const path = req.route?.path

  const method = req.method

  const tags = {
    chain: config.monitoring.metricEnvironmentTag,
    method,
    path,
    provider: toProviderTag(req.headers['x-auth-provider']),
  }

  const metric: Metric = {
    measurement: 'auto_drive_api_request',
    tags,
    fields: {
      status: res.statusCode,
    },
  }

  sendMetricToVictoria(metric)
}
