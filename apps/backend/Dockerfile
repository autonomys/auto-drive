# ---- Base ----
FROM node:20.18.3-bookworm-slim AS base
RUN corepack enable && corepack prepare yarn@4.2.2 --activate
WORKDIR /usr/src/app

# ---- Dependencies ----
FROM base AS deps

# Native build tools for @keyvhq/sqlite and other native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    git \
    libsqlite3-dev \
  && rm -rf /var/lib/apt/lists/*

# Copy workspace config for layer caching (package.json files + lockfile first)
COPY package.json yarn.lock .yarnrc.yml ./

# Copy all workspace package.json stubs
COPY apps/backend/package.json apps/backend/package.json
COPY apps/auth/package.json apps/auth/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/landing/package.json apps/landing/package.json
COPY apps/hasura/package.json apps/hasura/package.json
COPY packages/models/package.json packages/models/package.json
COPY packages/s3/package.json packages/s3/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY submodules/files-gateway/package.json submodules/files-gateway/package.json
COPY submodules/files-gateway/common/models/package.json submodules/files-gateway/common/models/package.json
COPY submodules/files-gateway/common/rpc-apis/package.json submodules/files-gateway/common/rpc-apis/package.json
COPY submodules/files-gateway/services/object-mapping-indexer/package.json submodules/files-gateway/services/object-mapping-indexer/package.json
COPY submodules/files-gateway/services/file-retriever/package.json submodules/files-gateway/services/file-retriever/package.json

RUN yarn install --immutable

# ---- Builder ----
FROM deps AS builder

# Copy full source
COPY . .

# Build in dependency order: submodules → models → s3 → backend
RUN yarn auto-files-gateway build \
  && yarn models build \
  && yarn s3 build \
  && yarn backend build

# ---- Production ----
FROM base AS production

# Runtime-only dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libsqlite3-0 \
  && rm -rf /var/lib/apt/lists/*

# Copy built artifacts and runtime files
COPY --from=builder /usr/src/app/package.json /usr/src/app/yarn.lock /usr/src/app/.yarnrc.yml ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /usr/src/app/apps/backend/package.json ./apps/backend/package.json
COPY --from=builder /usr/src/app/apps/backend/migrations ./apps/backend/migrations
COPY --from=builder /usr/src/app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /usr/src/app/packages/models/dist ./packages/models/dist
COPY --from=builder /usr/src/app/packages/models/package.json ./packages/models/package.json
COPY --from=builder /usr/src/app/packages/s3/dist ./packages/s3/dist
COPY --from=builder /usr/src/app/packages/s3/package.json ./packages/s3/package.json
COPY --from=builder /usr/src/app/submodules/files-gateway ./submodules/files-gateway

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["yarn", "workspace", "backend", "start:fe"]
