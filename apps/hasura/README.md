# Hasura

GraphQL API layer providing real-time queries and subscriptions over the Auto Drive database.

## Quick Start

```bash
# Ensure PostgreSQL is running and the backend migrations are applied
# (yarn backend db-migrate up), then start Hasura
yarn workspace hasura start
```

This applies metadata and opens the Hasura console.

## Commands

| Command                          | Description            |
| -------------------------------- | ---------------------- |
| `yarn workspace hasura console`  | Open Hasura console    |
| `yarn workspace hasura metadata` | Apply metadata changes |

## Configuration

Hasura connects to the same PostgreSQL database as the backend service. See `config.yaml` for connection settings.

## Schema changes

Hasura manages metadata only and never changes the database schema. Tables, views and functions that the metadata relies on, such as the functions behind computed fields, are backend migrations in `apps/backend/migrations`. Apply those before `hasura metadata apply`. Don't save schema changes made in the console as Hasura migrations.

## Metadata

The `metadata/` directory contains:

- Table configurations and permissions
- Relationships between tables
- Role-based access control rules

Changes made in the Hasura console are tracked in these files.
