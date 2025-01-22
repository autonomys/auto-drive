import { env } from "./utils/misc";

export const config = {
  port: env("AUTH_PORT", "3000"),
  logLevel: env("LOG_LEVEL", "info"),
  postgres: {
    url: env(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/postgres"
    ),
  },
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
  jwtSecret: env("JWT_SECRET"),
  apiSecret: env("API_SECRET"),
};
