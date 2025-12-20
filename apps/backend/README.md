# Backend Service

Core API service for Auto Drive handling file uploads, downloads, object management, and blockchain interactions.

## Quick Start

```bash
# Set up environment
cp .env.sample .env

# Start required services (PostgreSQL, RabbitMQ)
docker compose -f dev-docker-compose.yml up -d

# Start the frontend API server
yarn workspace backend dev start:fe
```

## Available Servers

The backend runs multiple server modes:

| Command                 | Description                    |
| ----------------------- | ------------------------------ |
| `start:fe`              | Frontend API server            |
| `start:fe:api`          | Frontend API only (no workers) |
| `start:fe:worker`       | Frontend worker only           |
| `start:download`        | Download server                |
| `start:download:api`    | Download API only              |
| `start:download:worker` | Download worker only           |

## Environment Variables

See `.env.sample` for required configuration including:

- `DATABASE_URL` - PostgreSQL connection string
- `RABBITMQ_URL` - RabbitMQ connection string
- `RPC_ENDPOINT` - Autonomys Network RPC endpoint
- `AUTH_SERVICE_URL` - Auth service URL

## Testing

```bash
yarn workspace backend test
```

## Further Documentation

- [docs/file-lifecycle.md](../../docs/file-lifecycle.md) - File upload and archival process
- [docs/payments.md](../../docs/payments.md) - Payment and credits system
- [docs/architecture.md](../../docs/architecture.md) - System architecture
