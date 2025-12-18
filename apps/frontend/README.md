# Frontend

Next.js web application for Auto Drive providing file upload, download, sharing, and API key management.

## Quick Start

```bash
# Set up environment
cp .env.sample .env.local

# Install dependencies (from repo root)
yarn install

# Start development server
yarn workspace frontend dev
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

## Features

- Upload and download files to/from Autonomys Network
- Share files with other users
- Manage API keys for programmatic access
- Web3 wallet authentication (SIWE)
- OAuth authentication (Google, Discord, GitHub)

## Environment Variables

See `.env.sample` for required configuration.

## GraphQL Codegen

To regenerate GraphQL types after schema changes:

```bash
yarn workspace frontend codegen
```

## Build

```bash
yarn workspace frontend build
yarn workspace frontend start
```
