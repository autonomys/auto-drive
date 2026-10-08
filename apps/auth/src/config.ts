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
  dsql: {
    clusterEndpoint: process.env.DSQL_CLUSTER_ENDPOINT,
    clusterPort: env('DSQL_CLUSTER_PORT', '5432'),
    region: process.env.AWS_REGION,
    dbName: env('DB_NAME', 'postgres'),
    user: env('DSQL_CLUSTER_USER', 'auth_user'),
    adminUser: env('DSQL_CLUSTER_ADMIN_USER', 'admin'),
  },
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
  jwtSecret: env('JWT_SECRET'),
  jwtSecretAlgorithm: env('JWT_SECRET_ALGORITHM', 'RS256'),
  apiSecret: env('API_SECRET'),
  revokeTokenEmittedBeforeInSeconds: Number(
    env('REVOKE_TOKEN_EMITTED_BEFORE_IN_SECONDS', '0'),
  ),
}
