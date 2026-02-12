# =============================================================================
# AUTO-DRIVE FRONTEND DOCKERFILE
# =============================================================================
# This Dockerfile is NEW and created for staging/production Docker deployments.
#
# ⚠️ IMPORTANT: In local development, the frontend runs via 'yarn frontend dev'
# outside of Docker. This Dockerfile is specifically for containerized deployments.
#
# Usage:
#   docker build -f apps/frontend/Dockerfile \
#     --build-arg NEXT_PUBLIC_ENV=local \
#     --build-arg NEXT_PUBLIC_AUTH_API_URL=https://staging.example.com/auth \
#     -t auto-drive-frontend .
#
# See STAGING_SETUP_GUIDE.md for complete documentation.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Install dependencies needed for native modules
RUN apk add --no-cache libc6-compat python3 make g++

# Enable corepack for Yarn
RUN corepack enable
RUN corepack prepare yarn@4.2.2 --activate

# Copy workspace configuration files
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Copy all package.json files for workspace resolution
COPY packages/models/package.json ./packages/models/
COPY packages/ui/package.json ./packages/ui/
COPY packages/s3/package.json ./packages/s3/
COPY apps/frontend/package.json ./apps/frontend/

# Install all dependencies
RUN yarn install --immutable

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache libc6-compat

RUN corepack enable
RUN corepack prepare yarn@4.2.2 --activate

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.yarn ./.yarn

# Copy source code
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages ./packages
COPY apps/frontend ./apps/frontend

# Build-time arguments for Next.js public environment variables
# These MUST be available at build time for Next.js to inline them into the client bundle
ARG NEXT_PUBLIC_ENV=local
ARG NEXT_PUBLIC_AUTH_API_URL
ARG NEXT_PUBLIC_LOCAL_RPC_URL
ARG NEXT_PUBLIC_LOCAL_DOWNLOAD_URL
ARG NEXT_PUBLIC_LOCAL_GQL_URL
ARG NEXT_PUBLIC_PROJECT_ID
ARG NEXT_PUBLIC_MAX_FILES_LIMIT=10
ARG NEXT_PUBLIC_MAINNET_HTTP_URL
ARG NEXT_PUBLIC_MAINNET_DOWNLOAD_URL
ARG NEXT_PUBLIC_MAINNET_GQL_URL

# Set environment variables for build
ENV NEXT_PUBLIC_ENV=${NEXT_PUBLIC_ENV}
ENV NEXT_PUBLIC_AUTH_API_URL=${NEXT_PUBLIC_AUTH_API_URL}
ENV NEXT_PUBLIC_LOCAL_RPC_URL=${NEXT_PUBLIC_LOCAL_RPC_URL}
ENV NEXT_PUBLIC_LOCAL_DOWNLOAD_URL=${NEXT_PUBLIC_LOCAL_DOWNLOAD_URL}
ENV NEXT_PUBLIC_LOCAL_GQL_URL=${NEXT_PUBLIC_LOCAL_GQL_URL}
ENV NEXT_PUBLIC_PROJECT_ID=${NEXT_PUBLIC_PROJECT_ID}
ENV NEXT_PUBLIC_MAX_FILES_LIMIT=${NEXT_PUBLIC_MAX_FILES_LIMIT}
ENV NEXT_PUBLIC_MAINNET_HTTP_URL=${NEXT_PUBLIC_MAINNET_HTTP_URL}
ENV NEXT_PUBLIC_MAINNET_DOWNLOAD_URL=${NEXT_PUBLIC_MAINNET_DOWNLOAD_URL}
ENV NEXT_PUBLIC_MAINNET_GQL_URL=${NEXT_PUBLIC_MAINNET_GQL_URL}

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build workspace packages first (dependencies of frontend)
RUN yarn workspace @auto-drive/models build
RUN yarn workspace @auto-drive/ui build

# Build the frontend application
RUN yarn workspace frontend build

# -----------------------------------------------------------------------------
# Stage 3: Runner
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public assets
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public

# Copy the standalone build output
# Note: This requires 'output: standalone' in next.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/static ./apps/frontend/.next/static

# Switch to non-root user
USER nextjs

# Expose the port Next.js runs on
EXPOSE 3000

# Set runtime environment
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the Next.js server
CMD ["node", "apps/frontend/server.js"]

