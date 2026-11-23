import { env } from './utils/misc.js'

const normalizeOrigin = (origin: string) =>
  origin.trim().replace(/\/+$/, '').toLowerCase()

// `https://app.example.com=<organizationId>,...`: each origin belongs to one
// partner organisation.
const parsePartnerOrigins = (value: string): Map<string, string> => {
  const origins = new Map<string, string>()
  for (const entry of value.split(',')) {
    if (!entry.trim()) continue
    const parts = entry.split('=').map((s) => s.trim())
    const [origin, organizationId] = parts
    const normalized = normalizeOrigin(origin)
    if (
      parts.length !== 2 ||
      !organizationId ||
      !URL.canParse(normalized) ||
      new URL(normalized).origin !== normalized ||
      !normalized.startsWith('https://') ||
      origins.has(normalized)
    ) {
      throw new Error(
        `WEB3_AUTH_PARTNER_ORIGINS: expected distinct https://origin=organizationId entries, got "${entry}"`,
      )
    }
    origins.set(normalized, organizationId)
  }
  return origins
}

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
      .map(normalizeOrigin)
      .filter(Boolean),
    // Partner origins: wallet sign-ins for one are accepted only from the
    // partner organisation's end users, who may sign in only for these.
    partnerOrigins: parsePartnerOrigins(
      process.env.WEB3_AUTH_PARTNER_ORIGINS ?? '',
    ),
  },
}
