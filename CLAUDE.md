# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Auto Drive is a decentralized content-addressed storage platform built on the Autonomys Network. It stores files as IPLD (InterPlanetary Linked Data) nodes on the Autonomys Distributed Storage Network (DSN). The system provides a web UI, REST API, S3-compatible API, and GraphQL API.

## Repository Structure

Yarn 4.2.2 monorepo with workspaces in `apps/`, `packages/`, and `submodules/`.

- **apps/backend** — Express.js API server (ESM, TypeScript). Runs as multiple processes: frontend API, download API, frontend worker, download worker.
- **apps/frontend** — Next.js 14 web app (React 18, Tailwind CSS, Zustand, Apollo Client). Routes are under `src/app/[chain]/`.
- **apps/auth** — Express.js auth microservice (JWT, OAuth via Google/Discord/GitHub, SIWE for Web3). Deployable as AWS Lambda.
- **apps/hasura** — Hasura GraphQL engine config (migrations and metadata).
- **apps/landing** — Next.js landing page.
- **packages/models** — Shared TypeScript types and schemas (`@auto-drive/models`).
- **packages/s3** — S3-compatible DTOs (`@auto-drive/s3`).
- **packages/ui** — Shared React components (`@auto-drive/ui`).
- **packages/contracts** — Solidity smart contracts (Foundry/OpenZeppelin) for payment system.
- **submodules/files-gateway** — IPLD node indexer and file retriever.

## Build & Development Commands

```bash
# Install dependencies
yarn install

# Initialize git submodules (required first time)
make init-submodules

# Build everything (submodules + models + ui + s3 + frontend + backend)
make all

# Build shared packages only (install + submodules + models + s3 + ui)
make common

# Build individual packages
yarn models build
yarn s3 build
yarn ui build
yarn backend build
yarn auth build
yarn landing build

# Build smart contracts (requires Foundry)
cd packages/contracts && forge build

# Update Autonomys SDK dependencies across all packages
yarn update:autonomys
```

### Running Services Locally

```bash
# Start infrastructure (PostgreSQL, RabbitMQ, Hasura)
docker compose -f docker-compose.dev.yml --env-file .env.dev up -d

# Run database migrations
yarn backend db-migrate up
yarn auth db-migrate up
cd apps/hasura && hasura migrate apply --admin-secret myadminsecretkey && hasura metadata apply --admin-secret myadminsecretkey && cd -

# Start services (each in separate terminal)
yarn frontend dev          # Next.js on port 8080
yarn backend start:fe      # Backend frontend server on port 3000
yarn auth start            # Auth on port 3030
yarn landing dev           # Landing page dev server
```

Backend can also be started as split processes:
- `yarn backend start:fe:api` — Frontend API only
- `yarn backend start:fe:worker` — Upload processing worker only
- `yarn backend start:download:api` — Download API only
- `yarn backend start:download:worker` — Download worker only

### Testing

```bash
# Run all tests (backend + auth)
yarn test

# Run backend tests only
yarn backend test

# Run auth tests only
yarn auth test
```

Tests use Jest with `--experimental-vm-modules` for ESM support and `--runInBand` (sequential execution). Backend tests use TestContainers for PostgreSQL and RabbitMQ (Docker required). Tests are organized as:
- `apps/backend/__tests__/e2e/` — End-to-end tests (uploads, downloads, objects, users)
- `apps/backend/__tests__/integration/` — Integration tests (S3 SDK)
- `apps/backend/__tests__/unit/` — Unit tests (core logic, repositories, event router)
- `apps/auth/__tests__/` — Auth service tests

Smart contract tests use Foundry: `cd packages/contracts && forge test`

### Linting

```bash
# Lint all services
yarn lint

# Lint individual services
yarn backend lint
yarn auth lint
yarn frontend lint
yarn landing lint
```

ESLint with `@typescript-eslint`, Prettier integration. Backend/auth also use `eslint-plugin-require-extensions` to enforce `.js` import extensions.

### GraphQL Codegen (Frontend)

```bash
yarn frontend codegen
```

## Architecture

### Backend Layered Architecture (`apps/backend/src/`)

The backend follows a clean layered architecture:

- **`app/`** — HTTP layer. `controllers/` handle Express routes, `apis/` compose Express apps, `servers/` are entry points that start APIs + workers.
- **`core/`** — Business logic (use cases). Pure functions that orchestrate repositories and services. Functions return `neverthrow` `Result` types for typed error handling.
- **`infrastructure/`** — External integrations:
  - `drivers/` — Database (pg), message queue (RabbitMQ/amqplib), Substrate chain connection, logging, metrics.
  - `repositories/` — PostgreSQL data access (objects metadata/nodes/ownership, uploads, users/accounts, S3 mappings).
  - `services/` — Auth verification, download caching (multi-tier: memory → filesystem → DSN), file gateway (DSN retrieval), on-chain publisher (Substrate), payment manager (EVM/viem), upload processor.
  - `eventRouter/` — RabbitMQ task processing. Tasks include: `migrate-upload-nodes`, `publish-nodes`, `tag-upload`, `archive-objects`, `async-download-created`, `populate-cache`.
- **`errors/`** — Typed HTTP errors extending `HttpError` base class with `handleResponse()`.
- **`shared/utils/`** — Express helpers (`asyncSafeHandler` wraps route handlers), filesystem utils, misc utilities.

### Error Handling Pattern

Backend uses `neverthrow` for typed errors in core logic. Functions return `Result<T, E>` instead of throwing. HTTP errors extend `HttpError` with status codes and are handled via `handleError()` in controllers.

### Frontend Architecture (`apps/frontend/src/`)

- Next.js App Router with dynamic `[chain]` segment (supports mainnet/taurus).
- State management with Zustand stores.
- GraphQL via Apollo Client (Hasura) + REST calls to backend.
- Web3 integration via wagmi/viem/RainbowKit.
- Auth via next-auth with custom JWT handling for the auth service.

### Data Flow

1. **Upload**: Client → Backend API → chunks to IPLD nodes → stores in PostgreSQL → publishes to RabbitMQ → Worker publishes nodes on-chain via Substrate RPC.
2. **Download**: Client → Download API → checks memory cache → filesystem cache → retrieves from DSN via files-gateway → streams back.
3. **Auth**: Client → next-auth → Auth service (JWT) → Backend validates JWT on each request.

### Database

PostgreSQL with `db-migrate` for migrations. Migration SQL files live in `apps/backend/migrations/sqls/` and `apps/auth/migrations/sqls/`. Key tables: `metadata`, `nodes`, `object_ownership`, `subscriptions`, `interactions`, `intents`, `uploads.*`.

### Message Queue

RabbitMQ queues: `task-manager`, `download-manager`, `frontend-errors`, `download-errors`. Tasks have a retry mechanism with `retriesLeft` counter.

## Code Conventions

- **ESM modules** — Backend and auth use `"type": "module"`. All imports must use `.js` extensions (even for `.ts` files). Enforced by `eslint-plugin-require-extensions`.
- **Strict TypeScript** — All packages use `strict: true`. Backend/auth use `module: "ESNext"` with `moduleResolution: "node"`.
- **Prettier** — Single quotes, `jsxSingleQuote: true`, tab width 2, trailing commas (`"all"`), print width 80. **Backend/auth/ui**: `semi: false` (no semicolons). **Frontend/landing**: `semi: true` (with semicolons) and use `prettier-plugin-tailwindcss`.
- **Workspace references** — Internal packages use `"workspace:*"` in package.json.
- **Logging** — Use `createLogger('namespace')` from `infrastructure/drivers/logger.ts`.
- **Config** — Centralized in `apps/backend/src/config.ts`, reads from environment variables with defaults.
- **Environment setup** — Each app has a `.env.sample` file. Copy to `.env` and customize before running.
