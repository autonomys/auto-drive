# Hasura

GraphQL API layer providing real-time queries and subscriptions over the Auto Drive database.

## Quick Start

```bash
# Ensure PostgreSQL is running, then start Hasura
yarn workspace hasura start
```

This applies metadata, runs migrations, and opens the Hasura console.

## Commands

| Command                          | Description             |
| -------------------------------- | ----------------------- |
| `yarn workspace hasura console`  | Open Hasura console     |
| `yarn workspace hasura metadata` | Apply metadata changes  |
| `yarn workspace hasura migrate`  | Run database migrations |

## Configuration

Hasura connects to the same PostgreSQL database as the backend service. See `config.yaml` for connection settings.

## Metadata

The `metadata/` directory contains:

- Table configurations and permissions
- Relationships between tables
- Role-based access control rules

Changes made in the Hasura console are tracked in these files.
