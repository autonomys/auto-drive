# Auth Service

Authentication microservice providing multi-provider OAuth, JWT session management, and API key authentication.

## Quick Start

```bash
# Set up environment
cp .env.sample .env

# Run migrations
yarn workspace auth migrate up

# Start development server
yarn workspace auth dev
```

The service runs on port 3000 by default (configurable via `AUTH_PORT`).

## Environment Variables

See `.env.sample` for required configuration including:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Base64-encoded JWT secret
- `API_SECRET` - Admin API authentication secret

## Testing

```bash
yarn workspace auth test
```

## Build

```bash
# Standard build
yarn workspace auth build

# Lambda build (for AWS deployment)
yarn workspace auth lambda:build
```

## Further Documentation

See [docs/auth.md](../../docs/auth.md) for detailed documentation on:

- Authentication providers (Google, Discord, GitHub, Web3/SIWE)
- JWT token structure and Hasura integration
- API endpoints
- Production deployment
