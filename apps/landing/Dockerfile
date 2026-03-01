# ---- Base ----
FROM node:20.18.3-bookworm-slim AS base
RUN corepack enable && corepack prepare yarn@4.2.2 --activate
WORKDIR /usr/src/app

# ---- Dependencies ----
FROM base AS deps

# Copy workspace config for layer caching
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

# Build in dependency order: ui → landing
RUN yarn ui build \
  && yarn landing build

# ---- Production ----
FROM node:20.18.3-bookworm-slim AS production

WORKDIR /usr/src/app

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Copy Next.js standalone output
COPY --from=builder /usr/src/app/apps/landing/public ./apps/landing/public
COPY --from=builder --chown=nextjs:nodejs /usr/src/app/apps/landing/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /usr/src/app/apps/landing/.next/static ./apps/landing/.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/landing/server.js"]
