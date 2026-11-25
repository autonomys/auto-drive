import { env } from './utils/misc.js'

export const config = {
  port: env('AUTH_PORT', '3000'),
  logLevel: env('LOG_LEVEL', 'info'),
  postgres: {
    url: env(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/postgres',
    ),
  },
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
  jwtSecret: env('JWT_SECRET'),
  jwtSecretAlgorithm: env('JWT_SECRET_ALGORITHM', 'RS256'),
  apiSecret: env('API_SECRET'),
  revokeTokenEmittedBeforeInSeconds: Number(
    env('REVOKE_TOKEN_EMITTED_BEFORE_IN_SECONDS', '0'),
  ),
  web3Auth: {
    // Frontend origins that wallet sign-in messages may be issued for
    allowedOrigins: env(
      'WEB3_AUTH_ALLOWED_ORIGINS',
      'https://explorer.ai3.storage',
    )
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, '').toLowerCase())
      .filter(Boolean),
  },
}
